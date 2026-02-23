#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const mongoUrl = process.env.MONGO_DATABASE_URL;
const pgUrl = process.env.POSTGRESQL_DATABASE_URL;
const contextRoot = process.env.OPERATOR_CONTEXT_ROOT || '.agent/context';
const outFile = process.env.OPERATOR_CONTEXT_OUT || path.posix.join(contextRoot, 'business-context.md');
const schemaProfileFile = path.posix.join(contextRoot, 'schema-profile.json');
const semanticModelFile = path.posix.join(contextRoot, 'semantic-model.yaml');
const indexFile = path.posix.join(contextRoot, 'index.json');
const metricsDir = path.posix.join(contextRoot, 'metrics');
const tenantsDir = path.posix.join(contextRoot, 'tenants');

async function main() {
  const sections = [];
  const generatedAt = new Date().toISOString();
  const indexEntries = [];
  const snapshot = {
    generatedAt,
    sources: {
      postgres: { status: 'skipped', reason: 'POSTGRESQL_DATABASE_URL not set' },
      mongo: { status: 'skipped', reason: 'MONGO_DATABASE_URL not set' },
    },
    entities: [],
    tables: [],
    collections: [],
    joins: [],
    tenantKeys: ['organizationId', 'agencyId'],
    piiGuidance: 'No row-level PII should be copied into context artifacts.',
    notes: [],
  };

  const semantic = {
    generatedAt,
    entities: [
      { name: 'Organization', keys: ['organizationId'], description: 'Installed customer account in Mercuri.' },
      { name: 'Agency', keys: ['agencyId'], description: 'Agency owner of one or more organizations.' },
      { name: 'Installation', keys: ['organizationId', 'createdAt'], description: 'Website/app installation events and app records.' },
      { name: 'Usage', keys: ['organizationId', 'createdAt'], description: 'Operational engagement signals like message and booking activity.' },
      { name: 'RevenueSignal', keys: ['organizationId', 'createdAt'], description: 'Credit/debit and billing activity proxies for monetization.' },
    ],
    mappings: [],
    kpis: [
      { id: 'active_installs_30d', definition: 'Distinct organizations with any usage/install signal in the last 30 days.' },
      { id: 'install_events_30d', definition: 'Installation log events captured in the last 30 days.' },
      { id: 'message_events_30d', definition: 'Message logs created in the last 30 days.' },
      { id: 'booking_events_30d', definition: 'Booking records created in the last 30 days.' },
      { id: 'abandoned_booking_events_30d', definition: 'Abandoned booking records created in the last 30 days.' },
      { id: 'credit_events_30d', definition: 'Credit log entries created in the last 30 days.' },
      { id: 'debit_events_30d', definition: 'Debit log entries created in the last 30 days.' },
    ],
    guidance: [
      'For goal planning, start with tenant dossier + relevant metric files.',
      'If a KPI needed for a recommendation is missing, ask a clarifying question before execution.',
      'Treat schema profile as technical truth and semantic model as business translation.',
    ],
  };

  sections.push('# Business Context Snapshot');
  sections.push(`Generated: ${generatedAt}`);
  sections.push('');
  sections.push('This file contains schema/metadata and aggregate signals only.');
  sections.push('No row-level PII should be copied into this artifact.');
  sections.push('Operator should use this as an entrypoint and load structured context files listed below.');
  sections.push('');

  await ensureDir(contextRoot);
  await ensureDir(metricsDir);
  await ensureDir(tenantsDir);

  if (!mongoUrl) {
    sections.push('## MongoDB');
    sections.push('- Skipped: `MONGO_DATABASE_URL` not set.');
    sections.push('');
    snapshot.notes.push('MongoDB skipped: MONGO_DATABASE_URL not set.');
  } else {
    const mongoResult = await collectMongoContext(mongoUrl);
    sections.push(mongoResult.markdown);
    snapshot.sources.mongo = mongoResult.source;
    snapshot.collections = mongoResult.collections;
    if (mongoResult.mappings.length > 0) {
      semantic.mappings.push(...mongoResult.mappings);
    }
  }

  if (!pgUrl) {
    sections.push('## PostgreSQL');
    sections.push('- Skipped: `POSTGRESQL_DATABASE_URL` not set.');
    sections.push('');
    snapshot.notes.push('PostgreSQL skipped: POSTGRESQL_DATABASE_URL not set.');
  } else {
    const pgResult = await collectPostgresContext(pgUrl);
    sections.push(pgResult.markdown);
    snapshot.sources.postgres = pgResult.source;
    snapshot.tables = pgResult.tables;
    snapshot.joins = pgResult.joins;
    snapshot.entities = pgResult.entities;
    if (pgResult.mappings.length > 0) {
      semantic.mappings.push(...pgResult.mappings);
    }

    await writeJson(path.posix.join(metricsDir, 'installs.json'), pgResult.metrics.installs);
    await writeJson(path.posix.join(metricsDir, 'usage.json'), pgResult.metrics.usage);
    await writeJson(path.posix.join(metricsDir, 'revenue.json'), pgResult.metrics.revenue);
    await writeJson(path.posix.join(metricsDir, 'funnel.json'), pgResult.metrics.funnel);

    indexEntries.push(
      mkIndex('metric', path.posix.join(metricsDir, 'installs.json'), ['installs', 'activation']),
      mkIndex('metric', path.posix.join(metricsDir, 'usage.json'), ['usage', 'engagement']),
      mkIndex('metric', path.posix.join(metricsDir, 'revenue.json'), ['revenue', 'billing']),
      mkIndex('metric', path.posix.join(metricsDir, 'funnel.json'), ['bookings', 'conversion'])
    );

    for (const tenant of pgResult.tenants) {
      const tenantPath = path.posix.join(tenantsDir, `org_${sanitizeForFile(String(tenant.organizationId || 'unknown'))}.md`);
      await writeText(tenantPath, renderTenantDossier(tenant, generatedAt));
      indexEntries.push(mkIndex('tenant', tenantPath, ['tenant', 'organization'], {
        entityId: String(tenant.organizationId || 'unknown'),
      }));
    }
  }

  await writeJson(schemaProfileFile, snapshot);
  await writeText(semanticModelFile, renderSemanticModel(semantic));

  indexEntries.push(
    mkIndex('schema', schemaProfileFile, ['schema', 'tables']),
    mkIndex('semantic', semanticModelFile, ['semantic', 'business-model'])
  );

  await writeJson(indexFile, {
    generatedAt,
    artifacts: indexEntries,
  });

  sections.push('## Operator Notes');
  sections.push('- Use this file as pinned context for business-aware planning and execution.');
  sections.push('- Structured artifacts generated:');
  sections.push(`  - \`${schemaProfileFile}\``);
  sections.push(`  - \`${semanticModelFile}\``);
  sections.push(`  - \`${path.posix.join(metricsDir, '*.json')}\``);
  sections.push(`  - \`${path.posix.join(tenantsDir, 'org_*.md')}\``);
  sections.push(`  - \`${indexFile}\``);
  sections.push('- If critical metrics are missing, ask clarifying questions before recommendations.');
  sections.push('');

  await writeText(outFile, sections.join('\n'));

  console.log(`Context written to ${outFile}`);
}

async function collectMongoContext(url) {
  let MongoClient;
  try {
    ({ MongoClient } = await import('mongodb'));
  } catch {
    return {
      markdown: [
      '## MongoDB',
      '- Failed: `mongodb` package is not installed.',
      '- Install with: `npm install mongodb`',
      '',
      ].join('\n'),
      source: { status: 'failed', reason: 'mongodb package missing' },
      collections: [],
      mappings: [],
    };
  }

  const client = new MongoClient(url, {
    serverSelectionTimeoutMS: 8000,
    connectTimeoutMS: 8000,
  });

  try {
    await client.connect();
    const dbName = inferMongoDbName(url);
    const db = client.db(dbName);
    const collections = await db.listCollections({}, { nameOnly: true }).toArray();
    const names = collections.map((c) => c.name).slice(0, 15);

    const lines = [];
    const outCollections = [];
    const mappings = [];
    lines.push('## MongoDB');
    lines.push(`- Database: \`${db.databaseName}\``);
    lines.push(`- Collections detected: ${collections.length}`);
    lines.push('');

    for (const name of names) {
      const coll = db.collection(name);
      let estimatedCount = null;
      try {
        estimatedCount = await coll.estimatedDocumentCount();
      } catch {
        estimatedCount = null;
      }

      let sampleKeys = [];
      try {
        const sample = await coll.findOne({}, { projection: { _id: 0 } });
        if (sample && typeof sample === 'object') {
          sampleKeys = Object.keys(sample).slice(0, 12);
        }
      } catch {
        sampleKeys = [];
      }

      outCollections.push({
        name,
        estimatedDocuments: estimatedCount,
        sampleFields: sampleKeys,
      });
      mappings.push({
        source: `mongo.${name}`,
        concept: inferConceptFromName(name),
      });

      lines.push(`### Collection: \`${name}\``);
      lines.push(`- Estimated documents: ${estimatedCount ?? 'n/a'}`);
      lines.push(`- Sample top-level fields: ${sampleKeys.length > 0 ? sampleKeys.join(', ') : 'n/a'}`);
      lines.push('');
    }

    return {
      markdown: lines.join('\n'),
      source: { status: 'ok', database: db.databaseName, collections: collections.length },
      collections: outCollections,
      mappings,
    };
  } catch (err) {
    return {
      markdown: [
      '## MongoDB',
      `- Connection failed: ${err.message}`,
      '',
      ].join('\n'),
      source: { status: 'failed', reason: err.message },
      collections: [],
      mappings: [],
    };
  } finally {
    await client.close().catch(() => {});
  }
}

async function collectPostgresContext(url) {
  let Client;
  try {
    ({ Client } = await import('pg'));
  } catch {
    return {
      markdown: [
      '## PostgreSQL',
      '- Failed: `pg` package is not installed.',
      '- Install with: `npm install pg`',
      '',
      ].join('\n'),
      source: { status: 'failed', reason: 'pg package missing' },
      tables: [],
      joins: [],
      entities: [],
      mappings: [],
      metrics: {
        installs: { generatedAt: new Date().toISOString(), status: 'skipped' },
        usage: { generatedAt: new Date().toISOString(), status: 'skipped' },
        revenue: { generatedAt: new Date().toISOString(), status: 'skipped' },
        funnel: { generatedAt: new Date().toISOString(), status: 'skipped' },
      },
      tenants: [],
    };
  }

  const client = new Client({
    connectionString: url,
    statement_timeout: 8000,
    query_timeout: 8000,
    ssl: url.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined,
  });

  try {
    await client.connect();
    const generatedAt = new Date().toISOString();
    const tableMeta = await fetchTableMetadata(client);
    const tableLookup = mkTableLookup(tableMeta);
    const tablesSample = tableMeta.slice(0, 40);

    const entities = inferEntities(tableMeta);
    const joins = inferJoins(tableMeta);
    const mappings = inferTableMappings(tableMeta);
    const metrics = await collectPostgresMetrics(client, tableLookup, generatedAt);
    const tenants = await collectTenantDossiers(client, tableLookup, generatedAt);

    const tablesRes = await client.query(
      `select table_schema, table_name
       from information_schema.tables
       where table_schema not in ('pg_catalog', 'information_schema')
         and table_type = 'BASE TABLE'
       order by table_schema, table_name
       limit 20`
    );

    const lines = [];
    lines.push('## PostgreSQL');
    lines.push(`- Tables detected (sample): ${tablesRes.rowCount}`);
    lines.push(`- Entity concepts mapped: ${entities.length}`);
    lines.push(`- Tenant dossiers generated: ${tenants.length}`);
    lines.push('');

    for (const t of tablesRes.rows) {
      const schema = t.table_schema;
      const table = t.table_name;

      const columnRes = await client.query(
        `select column_name, data_type
         from information_schema.columns
         where table_schema = $1 and table_name = $2
         order by ordinal_position
         limit 12`,
        [schema, table]
      );

      let estimate = null;
      try {
        const est = await client.query(
          `select c.reltuples::bigint as estimate
           from pg_class c
           join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = $1 and c.relname = $2`,
          [schema, table]
        );
        estimate = est.rows?.[0]?.estimate ?? null;
      } catch {
        estimate = null;
      }

      lines.push(`### Table: \`${schema}.${table}\``);
      lines.push(`- Estimated rows: ${estimate ?? 'n/a'}`);
      if (columnRes.rowCount > 0) {
        lines.push('- Columns:');
        for (const c of columnRes.rows) {
          lines.push(`  - ${c.column_name} (${c.data_type})`);
        }
      } else {
        lines.push('- Columns: n/a');
      }
      lines.push('');
    }

    return {
      markdown: lines.join('\n'),
      source: { status: 'ok', tables: tableMeta.length },
      tables: tablesSample,
      joins,
      entities,
      mappings,
      metrics,
      tenants,
    };
  } catch (err) {
    return {
      markdown: [
      '## PostgreSQL',
      `- Connection failed: ${err.message}`,
      '',
      ].join('\n'),
      source: { status: 'failed', reason: err.message },
      tables: [],
      joins: [],
      entities: [],
      mappings: [],
      metrics: {
        installs: { generatedAt: new Date().toISOString(), status: 'failed', reason: err.message },
        usage: { generatedAt: new Date().toISOString(), status: 'failed', reason: err.message },
        revenue: { generatedAt: new Date().toISOString(), status: 'failed', reason: err.message },
        funnel: { generatedAt: new Date().toISOString(), status: 'failed', reason: err.message },
      },
      tenants: [],
    };
  } finally {
    await client.end().catch(() => {});
  }
}

function inferMongoDbName(url) {
  try {
    const u = new URL(url);
    const name = u.pathname.replace(/^\/+/, '');
    return name || 'test';
  } catch {
    return 'test';
  }
}

function mkIndex(kind, artifactPath, topics, extras = {}) {
  return {
    kind,
    path: artifactPath,
    topics,
    ...extras,
  };
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

function sanitizeForFile(value) {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_');
}

async function fetchTableMetadata(client) {
  const tableRes = await client.query(
    `select table_schema, table_name
     from information_schema.tables
     where table_schema not in ('pg_catalog', 'information_schema')
       and table_type = 'BASE TABLE'
     order by table_schema, table_name`
  );

  const out = [];
  for (const row of tableRes.rows) {
    const columnRes = await client.query(
      `select column_name, data_type
       from information_schema.columns
       where table_schema = $1 and table_name = $2
       order by ordinal_position`,
      [row.table_schema, row.table_name]
    );
    out.push({
      schema: row.table_schema,
      table: row.table_name,
      columns: columnRes.rows.map((c) => ({ name: c.column_name, type: c.data_type })),
    });
  }
  return out;
}

function mkTableLookup(tableMeta) {
  const lookup = new Map();
  for (const t of tableMeta) {
    const key = `${t.schema}.${t.table}`;
    lookup.set(key, new Set(t.columns.map((c) => c.name)));
  }
  return lookup;
}

function hasTable(lookup, schema, table) {
  return lookup.has(`${schema}.${table}`);
}

function hasColumn(lookup, schema, table, column) {
  const cols = lookup.get(`${schema}.${table}`);
  return cols ? cols.has(column) : false;
}

function inferEntities(tableMeta) {
  const base = new Set();
  for (const t of tableMeta) {
    if (t.table.includes('organization')) base.add('Organization');
    if (t.table.includes('agency')) base.add('Agency');
    if (t.table.includes('app') || t.table.includes('install')) base.add('Installation');
    if (t.table.includes('message') || t.table.includes('booking')) base.add('Usage');
    if (t.table.includes('credit') || t.table.includes('debit') || t.table.includes('billing')) base.add('RevenueSignal');
  }
  return Array.from(base).sort();
}

function inferJoins(tableMeta) {
  const joins = [];
  for (const t of tableMeta) {
    const cols = t.columns.map((c) => c.name);
    if (cols.includes('organizationId')) {
      joins.push({ from: `${t.schema}.${t.table}.organizationId`, to: 'parent.organizations.organizationId' });
    }
    if (cols.includes('agencyId')) {
      joins.push({ from: `${t.schema}.${t.table}.agencyId`, to: 'agency.agencies.agencyId' });
    }
  }
  return joins;
}

function inferTableMappings(tableMeta) {
  return tableMeta.slice(0, 80).map((t) => ({
    source: `${t.schema}.${t.table}`,
    concept: inferConceptFromName(t.table),
  }));
}

function inferConceptFromName(name) {
  const n = name.toLowerCase();
  if (n.includes('organization')) return 'Organization';
  if (n.includes('agency')) return 'Agency';
  if (n.includes('install') || n.includes('app')) return 'Installation';
  if (n.includes('message') || n.includes('booking')) return 'Usage';
  if (n.includes('credit') || n.includes('debit') || n.includes('billing')) return 'RevenueSignal';
  return 'OperationalData';
}

async function collectPostgresMetrics(client, tableLookup, generatedAt) {
  return {
    generatedAt,
    installs: await buildInstallsMetrics(client, tableLookup, generatedAt),
    usage: await buildUsageMetrics(client, tableLookup, generatedAt),
    revenue: await buildRevenueMetrics(client, tableLookup, generatedAt),
    funnel: await buildFunnelMetrics(client, tableLookup, generatedAt),
  };
}

async function buildInstallsMetrics(client, tableLookup, generatedAt) {
  const out = {
    generatedAt,
    table: 'parent.appInstallationLogs',
    totals: {},
    series30d: [],
    notes: [],
  };
  if (!hasTable(tableLookup, 'parent', 'appInstallationLogs')) {
    out.notes.push('Table parent.appInstallationLogs not found.');
    return out;
  }

  out.totals.totalRows = await countRows(client, 'parent', 'appInstallationLogs');
  if (hasColumn(tableLookup, 'parent', 'appInstallationLogs', 'createdAt')) {
    out.totals.last30d = await countSince(client, 'parent', 'appInstallationLogs', 'createdAt', 30);
    out.series30d = await dailySeries(client, 'parent', 'appInstallationLogs', 'createdAt', 30);
  } else {
    out.notes.push('Column createdAt not found on parent.appInstallationLogs.');
  }
  return out;
}

async function buildUsageMetrics(client, tableLookup, generatedAt) {
  const out = {
    generatedAt,
    table: 'parent.messageLogs',
    totals: {},
    breakdowns: {},
    notes: [],
  };
  if (!hasTable(tableLookup, 'parent', 'messageLogs')) {
    out.notes.push('Table parent.messageLogs not found.');
    return out;
  }

  out.totals.totalRows = await countRows(client, 'parent', 'messageLogs');
  if (hasColumn(tableLookup, 'parent', 'messageLogs', 'createdAt')) {
    out.totals.last30d = await countSince(client, 'parent', 'messageLogs', 'createdAt', 30);
  }
  if (hasColumn(tableLookup, 'parent', 'messageLogs', 'status')) {
    out.breakdowns.status = await groupedCount(client, 'parent', 'messageLogs', 'status', 20);
  }
  if (hasColumn(tableLookup, 'parent', 'messageLogs', 'organizationId')) {
    out.breakdowns.topOrganizations = await topByCount(
      client,
      'parent',
      'messageLogs',
      'organizationId',
      hasColumn(tableLookup, 'parent', 'messageLogs', 'createdAt') ? 'createdAt' : null,
      10,
      30
    );
  }
  return out;
}

async function buildRevenueMetrics(client, tableLookup, generatedAt) {
  const out = {
    generatedAt,
    tables: {},
    notes: [],
  };

  for (const tableName of ['creditLogs', 'debitLogs']) {
    if (!hasTable(tableLookup, 'parent', tableName)) {
      out.tables[tableName] = { missing: true };
      continue;
    }
    const hasCreated = hasColumn(tableLookup, 'parent', tableName, 'createdAt');
    const metric = {
      totalRows: await countRows(client, 'parent', tableName),
      last30d: hasCreated ? await countSince(client, 'parent', tableName, 'createdAt', 30) : null,
    };
    const amountCol = await detectAmountColumn(client, 'parent', tableName);
    if (amountCol) {
      metric.sumAmount = await sumColumn(client, 'parent', tableName, amountCol);
      metric.sumAmount30d = hasCreated
        ? await sumColumnSince(client, 'parent', tableName, amountCol, 'createdAt', 30)
        : null;
      metric.amountColumn = amountCol;
    }
    out.tables[tableName] = metric;
  }
  return out;
}

async function buildFunnelMetrics(client, tableLookup, generatedAt) {
  const out = {
    generatedAt,
    tables: {},
    notes: [],
  };
  for (const tableName of ['bookings', 'abandonedBookings']) {
    if (!hasTable(tableLookup, 'parent', tableName)) {
      out.tables[tableName] = { missing: true };
      continue;
    }
    const hasCreated = hasColumn(tableLookup, 'parent', tableName, 'createdAt');
    const tableMetrics = {
      totalRows: await countRows(client, 'parent', tableName),
      last30d: hasCreated ? await countSince(client, 'parent', tableName, 'createdAt', 30) : null,
    };
    if (hasColumn(tableLookup, 'parent', tableName, 'status')) {
      tableMetrics.status = await groupedCount(client, 'parent', tableName, 'status', 20);
    }
    out.tables[tableName] = tableMetrics;
  }
  return out;
}

async function collectTenantDossiers(client, tableLookup, generatedAt) {
  if (!hasTable(tableLookup, 'parent', 'organizations') || !hasColumn(tableLookup, 'parent', 'organizations', 'organizationId')) {
    return [];
  }
  const orgRows = await client.query(
    `select "organizationId" as org_id
     from parent."organizations"
     order by "createdAt" desc nulls last
     limit 20`
  );

  const dossiers = [];
  for (const row of orgRows.rows) {
    const orgId = row.org_id;
    const dossier = {
      generatedAt,
      organizationId: orgId,
      summary: [],
      kpis: {},
      risks: [],
      opportunities: [],
    };

    if (hasTable(tableLookup, 'parent', 'apps') && hasColumn(tableLookup, 'parent', 'apps', 'organizationId')) {
      dossier.kpis.apps = await countByOrg(client, 'parent', 'apps', 'organizationId', orgId);
    }
    if (hasTable(tableLookup, 'parent', 'messageLogs') && hasColumn(tableLookup, 'parent', 'messageLogs', 'organizationId')) {
      dossier.kpis.messages30d = hasColumn(tableLookup, 'parent', 'messageLogs', 'createdAt')
        ? await countByOrgSince(client, 'parent', 'messageLogs', 'organizationId', orgId, 'createdAt', 30)
        : await countByOrg(client, 'parent', 'messageLogs', 'organizationId', orgId);
    }
    if (hasTable(tableLookup, 'parent', 'bookings') && hasColumn(tableLookup, 'parent', 'bookings', 'organizationId')) {
      dossier.kpis.bookings30d = hasColumn(tableLookup, 'parent', 'bookings', 'createdAt')
        ? await countByOrgSince(client, 'parent', 'bookings', 'organizationId', orgId, 'createdAt', 30)
        : await countByOrg(client, 'parent', 'bookings', 'organizationId', orgId);
    }

    const activityScore = Number(dossier.kpis.messages30d || 0) + Number(dossier.kpis.bookings30d || 0);
    if (activityScore === 0) {
      dossier.risks.push('Low recent activity detected in last 30 days.');
      dossier.opportunities.push('Trigger onboarding/re-activation sequence.');
    } else if (activityScore < 25) {
      dossier.risks.push('Moderate activity; potential churn risk.');
      dossier.opportunities.push('Recommend feature adoption campaign.');
    } else {
      dossier.opportunities.push('High signal account; candidate for expansion motions.');
    }
    dossier.summary.push(`Activity score (messages30d + bookings30d): ${activityScore}`);
    dossiers.push(dossier);
  }
  return dossiers;
}

function renderTenantDossier(tenant, generatedAt) {
  const lines = [];
  lines.push(`# Tenant Dossier: ${tenant.organizationId}`);
  lines.push(`Generated: ${generatedAt}`);
  lines.push('');
  lines.push('## KPI Snapshot');
  for (const [k, v] of Object.entries(tenant.kpis || {})) {
    lines.push(`- ${k}: ${v}`);
  }
  if (Object.keys(tenant.kpis || {}).length === 0) {
    lines.push('- No KPI data available.');
  }
  lines.push('');
  lines.push('## Summary');
  for (const item of tenant.summary || []) lines.push(`- ${item}`);
  if ((tenant.summary || []).length === 0) lines.push('- n/a');
  lines.push('');
  lines.push('## Risks');
  for (const item of tenant.risks || []) lines.push(`- ${item}`);
  if ((tenant.risks || []).length === 0) lines.push('- n/a');
  lines.push('');
  lines.push('## Opportunities');
  for (const item of tenant.opportunities || []) lines.push(`- ${item}`);
  if ((tenant.opportunities || []).length === 0) lines.push('- n/a');
  lines.push('');
  return lines.join('\n');
}

function renderSemanticModel(semantic) {
  const lines = [];
  lines.push(`# Semantic Model`);
  lines.push(`generatedAt: "${semantic.generatedAt}"`);
  lines.push('');
  lines.push('entities:');
  for (const e of semantic.entities) {
    lines.push(`  - name: ${yamlStr(e.name)}`);
    lines.push(`    description: ${yamlStr(e.description)}`);
    lines.push('    keys:');
    for (const k of e.keys) lines.push(`      - ${yamlStr(k)}`);
  }
  lines.push('');
  lines.push('mappings:');
  for (const m of semantic.mappings) {
    lines.push(`  - source: ${yamlStr(m.source)}`);
    lines.push(`    concept: ${yamlStr(m.concept)}`);
  }
  if (semantic.mappings.length === 0) lines.push('  - source: "n/a"\n    concept: "n/a"');
  lines.push('');
  lines.push('kpis:');
  for (const k of semantic.kpis) {
    lines.push(`  - id: ${yamlStr(k.id)}`);
    lines.push(`    definition: ${yamlStr(k.definition)}`);
  }
  lines.push('');
  lines.push('guidance:');
  for (const g of semantic.guidance) lines.push(`  - ${yamlStr(g)}`);
  lines.push('');
  return lines.join('\n');
}

function yamlStr(value) {
  return `"${String(value).replace(/"/g, '\\"')}"`;
}

function qIdent(v) {
  return `"${String(v).replace(/"/g, '""')}"`;
}

async function countRows(client, schema, table) {
  const res = await client.query(`select count(*)::bigint as c from ${qIdent(schema)}.${qIdent(table)}`);
  return Number(res.rows[0]?.c || 0);
}

async function countSince(client, schema, table, tsCol, days) {
  const res = await client.query(
    `select count(*)::bigint as c
     from ${qIdent(schema)}.${qIdent(table)}
     where ${qIdent(tsCol)} >= now() - ($1::text || ' days')::interval`,
    [String(days)]
  );
  return Number(res.rows[0]?.c || 0);
}

async function dailySeries(client, schema, table, tsCol, days) {
  const res = await client.query(
    `select date_trunc('day', ${qIdent(tsCol)})::date as day, count(*)::bigint as c
     from ${qIdent(schema)}.${qIdent(table)}
     where ${qIdent(tsCol)} >= now() - ($1::text || ' days')::interval
     group by 1
     order by 1`,
    [String(days)]
  );
  return res.rows.map((r) => ({ day: String(r.day), count: Number(r.c || 0) }));
}

async function groupedCount(client, schema, table, col, limit) {
  const res = await client.query(
    `select ${qIdent(col)} as key, count(*)::bigint as c
     from ${qIdent(schema)}.${qIdent(table)}
     group by 1
     order by c desc
     limit $1`,
    [limit]
  );
  return res.rows.map((r) => ({ key: r.key == null ? 'null' : String(r.key), count: Number(r.c || 0) }));
}

async function topByCount(client, schema, table, orgCol, tsCol, limit, days) {
  if (tsCol) {
    const res = await client.query(
      `select ${qIdent(orgCol)} as org, count(*)::bigint as c
       from ${qIdent(schema)}.${qIdent(table)}
       where ${qIdent(tsCol)} >= now() - ($2::text || ' days')::interval
       group by 1
       order by c desc
       limit $1`,
      [limit, String(days)]
    );
    return res.rows.map((r) => ({ organizationId: String(r.org), count: Number(r.c || 0) }));
  }
  const res = await client.query(
    `select ${qIdent(orgCol)} as org, count(*)::bigint as c
     from ${qIdent(schema)}.${qIdent(table)}
     group by 1
     order by c desc
     limit $1`,
    [limit]
  );
  return res.rows.map((r) => ({ organizationId: String(r.org), count: Number(r.c || 0) }));
}

async function detectAmountColumn(client, schema, table) {
  const res = await client.query(
    `select column_name
     from information_schema.columns
     where table_schema = $1 and table_name = $2
       and data_type in ('numeric', 'integer', 'bigint', 'double precision', 'real', 'decimal')
       and (
         lower(column_name) = 'amount'
         or lower(column_name) like '%amount%'
         or lower(column_name) like '%credit%'
         or lower(column_name) like '%debit%'
         or lower(column_name) like '%price%'
         or lower(column_name) like '%value%'
       )
     order by case when lower(column_name) = 'amount' then 0 else 1 end, column_name
     limit 1`,
    [schema, table]
  );
  return res.rows[0]?.column_name ?? null;
}

async function sumColumn(client, schema, table, col) {
  const res = await client.query(
    `select coalesce(sum(${qIdent(col)}), 0)::numeric as s
     from ${qIdent(schema)}.${qIdent(table)}`
  );
  return Number(res.rows[0]?.s || 0);
}

async function sumColumnSince(client, schema, table, col, tsCol, days) {
  const res = await client.query(
    `select coalesce(sum(${qIdent(col)}), 0)::numeric as s
     from ${qIdent(schema)}.${qIdent(table)}
     where ${qIdent(tsCol)} >= now() - ($1::text || ' days')::interval`,
    [String(days)]
  );
  return Number(res.rows[0]?.s || 0);
}

async function countByOrg(client, schema, table, orgCol, orgId) {
  const res = await client.query(
    `select count(*)::bigint as c
     from ${qIdent(schema)}.${qIdent(table)}
     where ${qIdent(orgCol)} = $1`,
    [orgId]
  );
  return Number(res.rows[0]?.c || 0);
}

async function countByOrgSince(client, schema, table, orgCol, orgId, tsCol, days) {
  const res = await client.query(
    `select count(*)::bigint as c
     from ${qIdent(schema)}.${qIdent(table)}
     where ${qIdent(orgCol)} = $1
       and ${qIdent(tsCol)} >= now() - ($2::text || ' days')::interval`,
    [orgId, String(days)]
  );
  return Number(res.rows[0]?.c || 0);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
