#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const pgUrl = process.env.POSTGRESQL_DATABASE_URL;
const contextRoot = process.env.OPERATOR_CONTEXT_ROOT || '.agent/context';
const packsDir = path.posix.join(contextRoot, 'tenant-packs');
const indexFile = path.posix.join(contextRoot, 'tenant-index.json');
const summaryFile = path.posix.join(contextRoot, 'tenant-context-summary.md');
const tenantLimit = Number(process.env.OPERATOR_TENANT_LIMIT || '30');

const ORG_COL_CANDIDATES = ['organizationId', 'organization_id', 'orgId', 'org_id'];
const AGENCY_COL_CANDIDATES = ['agencyId', 'agency_id'];
const INSTANCE_COL_CANDIDATES = [
  'instanceId',
  'instance_id',
  'appInstanceId',
  'app_instance_id',
  'installationId',
  'installation_id',
  'installId',
  'install_id',
];
const PLATFORM_COL_CANDIDATES = ['platform', 'provider', 'sourcePlatform', 'source_platform'];
const DOMAIN_COL_CANDIDATES = ['storeDomain', 'store_domain', 'shopDomain', 'shop_domain', 'domain', 'website'];
const CREATED_COL_CANDIDATES = ['createdAt', 'created_at', 'installedAt', 'installed_at'];
const UPDATED_COL_CANDIDATES = ['updatedAt', 'updated_at'];

const METRIC_FAMILIES = [
  { id: 'products', tableNameHints: ['product', 'catalog', 'inventory'] },
  { id: 'orders', tableNameHints: ['order', 'checkout'] },
  { id: 'bookings', tableNameHints: ['booking'] },
  { id: 'messages', tableNameHints: ['message', 'sms', 'whatsapp', 'conversation'] },
  { id: 'installs', tableNameHints: ['install', 'app'] },
];

async function main() {
  const generatedAt = new Date().toISOString();

  await ensureDir(contextRoot);
  await ensureDir(packsDir);

  if (!pgUrl) {
    await writeJson(indexFile, {
      generatedAt,
      status: 'skipped',
      reason: 'POSTGRESQL_DATABASE_URL not set',
      tenants: [],
    });
    await writeText(
      summaryFile,
      `# Tenant Context Refresh\nGenerated: ${generatedAt}\n\n- Skipped: \`POSTGRESQL_DATABASE_URL\` not set.\n`
    );
    console.log(`Tenant context skipped (missing POSTGRESQL_DATABASE_URL)`);
    return;
  }

  let Client;
  try {
    ({ Client } = await import('pg'));
  } catch {
    throw new Error('`pg` package is not installed. Install with: npm install pg');
  }

  const client = new Client({
    connectionString: pgUrl,
    statement_timeout: 12000,
    query_timeout: 12000,
    ssl: pgUrl.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined,
  });

  try {
    await client.connect();

    const meta = await fetchTableMeta(client);
    const tenantSeeds = await discoverTenantSeeds(client, meta, tenantLimit);
    const tenantEntries = [];

    for (const seed of tenantSeeds) {
      const tenantPack = await buildTenantPack(client, meta, seed, generatedAt);
      const fileStem = sanitizeFilePart(tenantPack.organizationId || tenantPack.instanceId || `tenant_${tenantEntries.length + 1}`);
      const packJsonPath = path.posix.join(packsDir, `${fileStem}.json`);
      const packMdPath = path.posix.join(packsDir, `${fileStem}.md`);

      await writeJson(packJsonPath, tenantPack);
      await writeText(packMdPath, renderTenantPackMarkdown(tenantPack));

      tenantEntries.push({
        organizationId: tenantPack.organizationId,
        instanceId: tenantPack.instanceId || null,
        platform: tenantPack.platform || null,
        storeDomain: tenantPack.storeDomain || null,
        packJson: packJsonPath,
        packMarkdown: packMdPath,
        confidence: tenantPack.confidence,
        generatedAt,
      });
    }

    await writeJson(indexFile, {
      generatedAt,
      status: 'ok',
      tenantCount: tenantEntries.length,
      tenants: tenantEntries,
      retrievalPolicy: {
        primaryKey: 'organizationId',
        fallbackKey: 'instanceId',
        rules: [
          'Load only one tenant pack per question.',
          'If tenant cannot be resolved, ask for organizationId or instanceId before planning.',
          'If required metrics are stale/missing, ask clarifying questions instead of guessing.',
        ],
      },
    });

    await writeText(summaryFile, renderSummaryMarkdown(generatedAt, tenantEntries));

    console.log(`Tenant context refreshed: ${tenantEntries.length} pack(s)`);
  } finally {
    await client.end().catch(() => {});
  }
}

async function discoverTenantSeeds(client, meta, limit) {
  const organizationsTable = findTableExact(meta, 'parent', 'organizations');
  if (organizationsTable) {
    const orgCol = findColumnName(organizationsTable.columns, ORG_COL_CANDIDATES);
    if (orgCol) {
      const agencyCol = findColumnName(organizationsTable.columns, AGENCY_COL_CANDIDATES);
      const createdCol = findColumnName(organizationsTable.columns, CREATED_COL_CANDIDATES);
      const cols = [orgCol, agencyCol, createdCol].filter(Boolean);
      const orderBy = createdCol ? `${qIdent(createdCol)} desc nulls last` : `${qIdent(orgCol)} asc`;
      const rows = await client.query(
        `select ${cols.map((c) => qIdent(c)).join(', ')}
         from ${qTable(organizationsTable)}
         where ${qIdent(orgCol)} is not null
         order by ${orderBy}
         limit $1`,
        [limit]
      );
      return rows.rows.map((r) => ({
        organizationId: normalizeValue(r[orgCol]),
        agencyId: agencyCol ? normalizeValue(r[agencyCol]) : null,
      }));
    }
  }

  const fallbackTable = meta.find((t) => findColumnName(t.columns, ORG_COL_CANDIDATES));
  if (!fallbackTable) return [];
  const orgCol = findColumnName(fallbackTable.columns, ORG_COL_CANDIDATES);
  const rows = await client.query(
    `select distinct ${qIdent(orgCol)} as org
     from ${qTable(fallbackTable)}
     where ${qIdent(orgCol)} is not null
     limit $1`,
    [limit]
  );
  return rows.rows.map((r) => ({
    organizationId: normalizeValue(r.org),
    agencyId: null,
  }));
}

async function buildTenantPack(client, meta, seed, generatedAt) {
  const identity = await discoverTenantIdentity(client, meta, seed.organizationId);
  const sourceCoverage = [];
  const metrics = {};
  let freshness = null;

  for (const family of METRIC_FAMILIES) {
    const candidates = findFamilyTables(meta, family.tableNameHints).slice(0, 8);
    const familyMetrics = {
      tables: [],
      totalRowsForTenant: 0,
      rowsLast30d: 0,
    };

    for (const table of candidates) {
      const orgCol = findColumnName(table.columns, ORG_COL_CANDIDATES);
      if (!orgCol) continue;
      const tsCol = findColumnName(table.columns, CREATED_COL_CANDIDATES) || findColumnName(table.columns, UPDATED_COL_CANDIDATES);

      const total = await countByOrg(client, table, orgCol, seed.organizationId);
      let last30d = null;
      if (tsCol) {
        last30d = await countByOrgSince(client, table, orgCol, seed.organizationId, tsCol, 30);
      }
      const latestTs = tsCol ? await maxTimestampByOrg(client, table, orgCol, seed.organizationId, tsCol) : null;
      if (latestTs && (!freshness || latestTs > freshness)) freshness = latestTs;

      familyMetrics.tables.push({
        table: `${table.schema}.${table.table}`,
        orgColumn: orgCol,
        timestampColumn: tsCol,
        totalRowsForTenant: total,
        rowsLast30d: last30d,
      });
      familyMetrics.totalRowsForTenant += total;
      familyMetrics.rowsLast30d += last30d ?? 0;

      sourceCoverage.push({
        source: `${table.schema}.${table.table}`,
        totalRowsForTenant: total,
        rowsLast30d: last30d,
        latestEventAt: latestTs,
      });
    }

    metrics[family.id] = familyMetrics;
  }

  const missingFields = [];
  if (!identity.instanceId) missingFields.push('instanceId');
  if (!identity.platform) missingFields.push('platform');
  if (!identity.storeDomain) missingFields.push('storeDomain');

  const confidence = missingFields.length === 0 ? 'high' : missingFields.length === 1 ? 'medium' : 'low';
  const needsClarification = missingFields.length > 0;

  return {
    generatedAt,
    organizationId: seed.organizationId,
    agencyId: seed.agencyId || identity.agencyId || null,
    instanceId: identity.instanceId || null,
    platform: identity.platform || null,
    storeDomain: identity.storeDomain || null,
    freshness: freshness || null,
    metrics,
    sourceCoverage,
    planningHints: [
      'Resolve tenant by organizationId first (instanceId as fallback).',
      'Do not mix data across organizationId or instanceId.',
      'If missing fields block recommendation quality, ask clarifying questions before planning.',
    ],
    missingFields,
    needsClarification,
    confidence,
  };
}

async function discoverTenantIdentity(client, meta, organizationId) {
  const preferredTables = [
    ['parent', 'apps'],
    ['parent', 'appMetaData'],
    ['parent', 'appInstallationLogs'],
    ['parent', 'organizations'],
  ];

  for (const [schema, table] of preferredTables) {
    const t = findTableExact(meta, schema, table);
    if (!t) continue;

    const orgCol = findColumnName(t.columns, ORG_COL_CANDIDATES);
    if (!orgCol) continue;

    const instanceCol = findColumnName(t.columns, INSTANCE_COL_CANDIDATES);
    const platformCol = findColumnName(t.columns, PLATFORM_COL_CANDIDATES);
    const domainCol = findColumnName(t.columns, DOMAIN_COL_CANDIDATES);
    const agencyCol = findColumnName(t.columns, AGENCY_COL_CANDIDATES);
    const createdCol = findColumnName(t.columns, CREATED_COL_CANDIDATES);

    const selectCols = [instanceCol, platformCol, domainCol, agencyCol].filter(Boolean);
    if (selectCols.length === 0) continue;

    const orderBy = createdCol ? `${qIdent(createdCol)} desc nulls last` : '';
    const rowRes = await client.query(
      `select ${selectCols.map((c) => qIdent(c)).join(', ')}
       from ${qTable(t)}
       where ${qIdent(orgCol)} = $1
       ${orderBy ? `order by ${orderBy}` : ''}
       limit 1`,
      [organizationId]
    );
    if (rowRes.rowCount === 0) continue;
    const row = rowRes.rows[0];
    return {
      instanceId: instanceCol ? normalizeValue(row[instanceCol]) : null,
      platform: platformCol ? normalizeValue(row[platformCol]) : null,
      storeDomain: domainCol ? normalizeValue(row[domainCol]) : null,
      agencyId: agencyCol ? normalizeValue(row[agencyCol]) : null,
    };
  }

  return {
    instanceId: null,
    platform: null,
    storeDomain: null,
    agencyId: null,
  };
}

async function fetchTableMeta(client) {
  const tables = await client.query(
    `select table_schema, table_name
     from information_schema.tables
     where table_schema not in ('pg_catalog', 'information_schema')
       and table_type = 'BASE TABLE'
     order by table_schema, table_name`
  );

  const out = [];
  for (const t of tables.rows) {
    const cols = await client.query(
      `select column_name
       from information_schema.columns
       where table_schema = $1 and table_name = $2
       order by ordinal_position`,
      [t.table_schema, t.table_name]
    );
    out.push({
      schema: t.table_schema,
      table: t.table_name,
      columns: cols.rows.map((r) => r.column_name),
    });
  }
  return out;
}

function findFamilyTables(meta, hints) {
  const lowHints = hints.map((h) => h.toLowerCase());
  return meta.filter((t) => {
    const n = t.table.toLowerCase();
    return lowHints.some((h) => n.includes(h));
  });
}

function findTableExact(meta, schema, table) {
  return meta.find((t) => t.schema === schema && t.table === table);
}

function findColumnName(columns, candidates) {
  const map = new Map(columns.map((c) => [c.toLowerCase(), c]));
  for (const c of candidates) {
    const v = map.get(c.toLowerCase());
    if (v) return v;
  }
  return null;
}

function qIdent(v) {
  return `"${String(v).replace(/"/g, '""')}"`;
}

function qTable(t) {
  return `${qIdent(t.schema)}.${qIdent(t.table)}`;
}

async function countByOrg(client, table, orgCol, orgId) {
  const res = await client.query(
    `select count(*)::bigint as c
     from ${qTable(table)}
     where ${qIdent(orgCol)} = $1`,
    [orgId]
  );
  return Number(res.rows[0]?.c || 0);
}

async function countByOrgSince(client, table, orgCol, orgId, tsCol, days) {
  const res = await client.query(
    `select count(*)::bigint as c
     from ${qTable(table)}
     where ${qIdent(orgCol)} = $1
       and ${qIdent(tsCol)} >= now() - ($2::text || ' days')::interval`,
    [orgId, String(days)]
  );
  return Number(res.rows[0]?.c || 0);
}

async function maxTimestampByOrg(client, table, orgCol, orgId, tsCol) {
  const res = await client.query(
    `select max(${qIdent(tsCol)}) as m
     from ${qTable(table)}
     where ${qIdent(orgCol)} = $1`,
    [orgId]
  );
  return res.rows[0]?.m ? new Date(res.rows[0].m).toISOString() : null;
}

function normalizeValue(v) {
  if (v == null) return null;
  return String(v);
}

function renderTenantPackMarkdown(pack) {
  const lines = [];
  lines.push(`# Tenant Context Pack`);
  lines.push(`Generated: ${pack.generatedAt}`);
  lines.push('');
  lines.push('## Identity');
  lines.push(`- organizationId: ${pack.organizationId || 'n/a'}`);
  lines.push(`- instanceId: ${pack.instanceId || 'n/a'}`);
  lines.push(`- platform: ${pack.platform || 'n/a'}`);
  lines.push(`- storeDomain: ${pack.storeDomain || 'n/a'}`);
  lines.push(`- agencyId: ${pack.agencyId || 'n/a'}`);
  lines.push(`- confidence: ${pack.confidence}`);
  lines.push('');
  lines.push('## Metrics');
  for (const [family, m] of Object.entries(pack.metrics || {})) {
    lines.push(`### ${family}`);
    lines.push(`- totalRowsForTenant: ${m.totalRowsForTenant || 0}`);
    lines.push(`- rowsLast30d: ${m.rowsLast30d || 0}`);
    if ((m.tables || []).length === 0) {
      lines.push('- tables: n/a');
    } else {
      for (const t of m.tables) {
        lines.push(`- table ${t.table}: total=${t.totalRowsForTenant}, last30d=${t.rowsLast30d ?? 'n/a'}`);
      }
    }
    lines.push('');
  }
  lines.push('## Guardrails');
  for (const h of pack.planningHints || []) lines.push(`- ${h}`);
  if (pack.needsClarification) {
    lines.push(`- Missing fields: ${pack.missingFields.join(', ')}`);
  }
  lines.push('');
  return lines.join('\n');
}

function renderSummaryMarkdown(generatedAt, entries) {
  const lines = [];
  lines.push('# Tenant Context Refresh');
  lines.push(`Generated: ${generatedAt}`);
  lines.push('');
  lines.push(`- Tenant packs generated: ${entries.length}`);
  lines.push('- Index file: `.agent/context/tenant-index.json`');
  lines.push('- Packs folder: `.agent/context/tenant-packs/`');
  lines.push('');
  lines.push('## Retrieval Policy');
  lines.push('- Resolve by `organizationId` first, fallback to `instanceId`.');
  lines.push('- Never mix data from multiple tenants in one response.');
  lines.push('- Ask clarifying questions when critical fields are missing.');
  lines.push('');
  return lines.join('\n');
}

async function ensureDir(dirPath) {
  const abs = path.resolve(process.cwd(), dirPath);
  await mkdir(abs, { recursive: true });
}

async function writeText(filePath, content) {
  const abs = path.resolve(process.cwd(), filePath);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, content, 'utf-8');
}

async function writeJson(filePath, obj) {
  await writeText(filePath, JSON.stringify(obj, null, 2));
}

function sanitizeFilePart(v) {
  return String(v).replace(/[^a-zA-Z0-9_-]/g, '_');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
