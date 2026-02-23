import { ConfigLoader } from '../config/loader.js';
import { ToolRegistry } from '../tools/registry.js';
import { PolicyEngine } from '../policy/engine.js';
import { LLMRouter } from '../llm/router.js';
import { registerCoreTools } from '../cli/commands/init.js';
import { zodToJsonSchema } from '../utils/schema.js';
import { generateRunId } from '../utils/paths.js';
import type { ActionDescriptor, ExecutionContext } from '../tools/types.js';
import type { LLMMessage } from '../llm/types.js';
import {
    loadTenantRuntimeContext,
    resolveTenantForInput,
    tenantResolutionMessage,
} from '../tenant/context.js';

export interface RunOperatorRequest {
    message: string;
    organizationId: string;
    instanceId?: string;
    cwd?: string;
    maxIterations?: number;
    autonomous?: boolean;
    dryRun?: boolean;
    approvalHandler?: (action: ActionDescriptor) => Promise<boolean>;
}

export interface RunOperatorResponse {
    success: boolean;
    output: string;
    blocked?: boolean;
    error?: string;
    tenant: {
        organizationId: string;
        instanceId?: string;
    };
    logs: string[];
    toolCalls: number;
    provider?: string;
    model?: string;
}

/**
 * Backend adapter for SaaS integration.
 * Use authenticated org/session claims to run Operator with strict tenant context.
 */
export async function runOperator(request: RunOperatorRequest): Promise<RunOperatorResponse> {
    const cwd = request.cwd ?? process.cwd();
    const logs: string[] = [];
    const safeMessage = request.message?.trim();
    if (!safeMessage) {
        return {
            success: false,
            output: '',
            error: 'message is required',
            tenant: { organizationId: request.organizationId, instanceId: request.instanceId },
            logs,
            toolCalls: 0,
        };
    }
    if (!request.organizationId?.trim()) {
        return {
            success: false,
            output: '',
            error: 'organizationId is required',
            tenant: { organizationId: request.organizationId || '', instanceId: request.instanceId },
            logs,
            toolCalls: 0,
        };
    }

    const config = await new ConfigLoader().load();
    const registry = ToolRegistry.getInstance();
    registerCoreTools(registry);
    const policy = new PolicyEngine(config, cwd);
    const llmRouter = new LLMRouter(config);

    const ctx: ExecutionContext = {
        runId: generateRunId(),
        cwd,
        config,
        autonomous: request.autonomous ?? false,
        dryRun: request.dryRun ?? false,
        approvedPermissions: new Set(),
        onApproval: request.approvalHandler,
        onProgress: (msg) => logs.push(msg),
    };

    const tenantRuntime = await loadTenantRuntimeContext(cwd);
    const resolverInput = `organizationId:${request.organizationId}${request.instanceId ? ` instanceId:${request.instanceId}` : ''}`;
    const tenantResolution = await resolveTenantForInput(cwd, resolverInput, tenantRuntime);
    if (tenantResolution.blocked) {
        return {
            success: false,
            blocked: true,
            output: '',
            error: tenantResolutionMessage(),
            tenant: { organizationId: request.organizationId, instanceId: request.instanceId },
            logs,
            toolCalls: 0,
        };
    }

    const toolDefs = registry.list().map((t) => {
        const fullTool = registry.get(t.name);
        return {
            name: t.name,
            description: t.description,
            inputSchema: fullTool ? zodToJsonSchema(fullTool.inputSchema) : {},
        };
    });

    const messages: LLMMessage[] = [
        {
            role: 'system',
            content: `You are an autonomous AI operator that accomplishes tasks using available tools.
Use tools proactively when needed and keep responses concise.
If critical context is missing, ask a concise clarifying question before recommendations.`,
        },
        ...(tenantResolution.tenantContextPrompt
            ? [{ role: 'system' as const, content: tenantResolution.tenantContextPrompt }]
            : []),
        { role: 'user', content: safeMessage },
    ];

    const maxIterations = request.maxIterations ?? 20;
    let finalOutput = '';
    let totalToolCalls = 0;
    let provider = '';
    let model = '';

    for (let i = 0; i < maxIterations; i++) {
        const response = await llmRouter.chat({ messages, tools: toolDefs });
        provider = response.provider;
        model = response.model;

        if (!response.toolCalls || response.toolCalls.length === 0) {
            finalOutput = response.content;
            break;
        }

        messages.push({
            role: 'assistant',
            content: response.content || '',
            toolCalls: response.toolCalls,
        });

        for (const tc of response.toolCalls) {
            totalToolCalls += 1;
            const tool = registry.get(tc.name);
            if (!tool) {
                messages.push({
                    role: 'tool',
                    content: JSON.stringify({ error: `Tool ${tc.name} not found` }),
                    toolCallId: tc.id,
                });
                continue;
            }

            const action: ActionDescriptor = {
                tool: tc.name,
                operation: tc.name,
                description: `Calling ${tc.name}`,
                permissions: tool.permissions,
                args: tc.args as Record<string, unknown>,
                riskLevel: 'medium',
            };

            const perm = await policy.checkPermission(action, ctx);
            if (!perm.allowed && perm.requiresApproval) {
                const approved = await policy.requestApproval(action, ctx);
                if (!approved) {
                    messages.push({
                        role: 'tool',
                        content: JSON.stringify({ error: 'Permission denied by policy/approval handler' }),
                        toolCallId: tc.id,
                    });
                    continue;
                }
            } else if (!perm.allowed) {
                messages.push({
                    role: 'tool',
                    content: JSON.stringify({ error: perm.reason }),
                    toolCallId: tc.id,
                });
                continue;
            }

            const result = await registry.execute(tc.name, tc.args, ctx);
            logs.push(`${tc.name}: ${result.success ? 'ok' : `error (${result.error})`}`);
            messages.push({
                role: 'tool',
                content: JSON.stringify(result.data ?? { error: result.error }),
                toolCallId: tc.id,
            });
        }
    }

    if (!finalOutput) {
        finalOutput = 'No final output produced within iteration limit.';
    }

    return {
        success: true,
        output: finalOutput,
        tenant: {
            organizationId: tenantResolution.organizationId || request.organizationId,
            instanceId: tenantResolution.instanceId || request.instanceId,
        },
        logs,
        toolCalls: totalToolCalls,
        provider,
        model,
    };
}
