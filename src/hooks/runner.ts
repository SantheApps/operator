import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { HookDefinition, HookContext, HookResult } from './types.js';

const execFileAsync = promisify(execFile);

/**
 * Hook Runner — executes hook commands as child processes
 *
 * Supports template variables in commands:
 *   {{name}}   → ctx.name (tool/skill/plan name)
 *   {{event}}  → ctx.event
 *   {{cwd}}    → ctx.cwd
 *   {{runId}}  → ctx.runId
 *   {{path}}   → ctx.args.path (if present)
 */
export class HookRunner {
    /**
     * Execute a single hook command
     */
    async execute(hook: HookDefinition, ctx: HookContext): Promise<HookResult> {
        const start = Date.now();

        try {
            // Resolve template variables in command
            const command = this.interpolate(hook.command, ctx);
            const cwd = hook.cwd ?? ctx.cwd;
            const timeout = hook.timeout ?? 10_000;

            const { stdout, stderr } = await execFileAsync(
                '/bin/sh',
                ['-c', command],
                {
                    cwd,
                    timeout,
                    env: {
                        ...process.env,
                        AGENT_HOOK_EVENT: ctx.event,
                        AGENT_HOOK_NAME: ctx.name ?? '',
                        AGENT_HOOK_RUN_ID: ctx.runId ?? '',
                        AGENT_HOOK_CWD: ctx.cwd,
                    },
                }
            );

            return {
                hook,
                event: ctx.event,
                success: true,
                stdout: stdout.toString().trim(),
                stderr: stderr.toString().trim(),
                durationMs: Date.now() - start,
            };
        } catch (err) {
            return {
                hook,
                event: ctx.event,
                success: false,
                error: (err as Error).message,
                durationMs: Date.now() - start,
            };
        }
    }

    /**
     * Replace {{variable}} placeholders in a command string
     */
    private interpolate(command: string, ctx: HookContext): string {
        let result = command;
        result = result.replace(/\{\{name\}\}/g, ctx.name ?? '');
        result = result.replace(/\{\{event\}\}/g, ctx.event);
        result = result.replace(/\{\{cwd\}\}/g, ctx.cwd);
        result = result.replace(/\{\{runId\}\}/g, ctx.runId ?? '');

        // Support {{path}} from args
        if (ctx.args?.['path']) {
            result = result.replace(/\{\{path\}\}/g, String(ctx.args['path']));
        }

        return result;
    }
}
