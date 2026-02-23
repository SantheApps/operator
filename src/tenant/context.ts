import { readFile } from 'node:fs/promises';
import path from 'node:path';

export interface TenantIndexEntry {
    organizationId: string | null;
    instanceId: string | null;
    platform?: string | null;
    storeDomain?: string | null;
    packJson?: string;
    packMarkdown?: string;
    confidence?: string;
}

interface TenantIndexFile {
    status?: string;
    tenantCount?: number;
    tenants?: TenantIndexEntry[];
    retrievalPolicy?: {
        primaryKey?: string;
        fallbackKey?: string;
        rules?: string[];
    };
}

export interface TenantRuntimeContext {
    enforce: boolean;
    status: string;
    entries: TenantIndexEntry[];
}

export interface TenantResolution {
    resolved: boolean;
    blocked: boolean;
    reason?: string;
    organizationId?: string;
    instanceId?: string;
    tenantContextPrompt?: string;
}

export interface TenantResolutionOptions {
    strictTenantContext?: boolean;
}

export async function loadTenantRuntimeContext(cwd: string): Promise<TenantRuntimeContext> {
    const indexPath = path.join(cwd, '.agent', 'context', 'tenant-index.json');
    try {
        const raw = await readFile(indexPath, 'utf-8');
        const parsed = JSON.parse(raw) as TenantIndexFile;
        const entries = parsed.tenants ?? [];
        const status = parsed.status ?? 'unknown';
        const enforce = status === 'ok' && entries.length > 0;
        return { enforce, status, entries };
    } catch {
        return { enforce: false, status: 'missing', entries: [] };
    }
}

export async function resolveTenantForInput(
    cwd: string,
    userInput: string,
    runtime: TenantRuntimeContext,
    options?: TenantResolutionOptions
): Promise<TenantResolution> {
    const strict = options?.strictTenantContext ?? false;

    if (!runtime.enforce && strict) {
        return {
            resolved: false,
            blocked: true,
            reason: 'tenant_context_not_ready',
        };
    }

    if (!runtime.enforce) {
        return { resolved: false, blocked: false, reason: 'tenant_guard_not_enforced' };
    }

    const envOrg = readEnv('OPERATOR_ORGANIZATION_ID');
    const envInstance = readEnv('OPERATOR_INSTANCE_ID');
    const inputOrg = extractTaggedValue(userInput, ['organizationid', 'organization_id', 'orgid', 'org_id']);
    const inputInstance = extractTaggedValue(userInput, ['instanceid', 'instance_id', 'installid', 'installationid']);
    const inputStoreDomain = extractStoreDomain(userInput);

    const orgCandidate = envOrg || inputOrg || null;
    const instanceCandidate = envInstance || inputInstance || null;

    let match: TenantIndexEntry | undefined;
    if (orgCandidate) {
        match = runtime.entries.find((e) => asStr(e.organizationId) === orgCandidate);
    }
    if (!match && instanceCandidate) {
        match = runtime.entries.find((e) => asStr(e.instanceId) === instanceCandidate);
    }
    if (!match && inputStoreDomain) {
        match = runtime.entries.find((e) => asStr(e.storeDomain) === inputStoreDomain);
    }

    if (!match) {
        return {
            resolved: false,
            blocked: true,
            reason: 'unresolved_tenant',
        };
    }

    const organizationId = asStr(match.organizationId) || '';
    const instanceId = asStr(match.instanceId) || '';
    const prompt = await buildTenantPrompt(cwd, match);

    return {
        resolved: true,
        blocked: false,
        organizationId,
        instanceId: instanceId || undefined,
        tenantContextPrompt: prompt,
    };
}

function readEnv(key: string): string | null {
    const val = process.env[key];
    return val && val.trim() ? val.trim() : null;
}

function extractTaggedValue(input: string, aliases: string[]): string | null {
    for (const a of aliases) {
        const rx = new RegExp(`${a}\\s*[:=]\\s*([a-zA-Z0-9_-]{3,})`, 'i');
        const m = input.match(rx);
        if (m?.[1]) return m[1];
    }
    return null;
}

function extractStoreDomain(input: string): string | null {
    const m = input.match(/([a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+)/);
    return m?.[1] ?? null;
}

function asStr(v: string | null | undefined): string | null {
    if (!v) return null;
    const s = String(v).trim();
    return s ? s : null;
}

async function buildTenantPrompt(cwd: string, entry: TenantIndexEntry): Promise<string> {
    const lines: string[] = [];
    lines.push('TENANT CONTEXT REQUIREMENTS:');
    lines.push('- This request is tenant-scoped. Use only the resolved tenant context.');
    lines.push('- Never mix data across organizations or instances.');
    lines.push(`- Resolved organizationId: ${entry.organizationId ?? 'n/a'}`);
    if (entry.instanceId) lines.push(`- Resolved instanceId: ${entry.instanceId}`);
    if (entry.platform) lines.push(`- Platform: ${entry.platform}`);
    if (entry.storeDomain) lines.push(`- Store domain: ${entry.storeDomain}`);

    if (entry.packMarkdown) {
        const abs = path.resolve(cwd, entry.packMarkdown);
        try {
            const md = await readFile(abs, 'utf-8');
            const clipped = md.length > 3000 ? `${md.slice(0, 3000)}\n...` : md;
            lines.push('\nTENANT PACK SNAPSHOT:');
            lines.push(clipped);
        } catch {
            // Ignore missing pack file and keep the guard prompt.
        }
    }

    lines.push('\nIf critical tenant metrics are missing/stale, ask concise clarifying questions before recommendations.');
    return lines.join('\n');
}

export function tenantResolutionMessage(): string {
    return [
        'Tenant business context is required before continuing.',
        'Generate tenant packs first (operator-tenant-context-refresh), then provide `organizationId` (preferred) or `instanceId`,',
        'or set env vars `OPERATOR_ORGANIZATION_ID` / `OPERATOR_INSTANCE_ID`.',
    ].join(' ');
}
