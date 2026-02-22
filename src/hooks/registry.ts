import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
import type { HookEvent, HookDefinition, HookContext, HookResult } from './types.js';
import { ALL_HOOK_EVENTS } from './types.js';
import { HookRunner } from './runner.js';

/**
 * Hook Registry — stores hook definitions and dispatches events
 *
 * Hooks are loaded from:
 * 1. `.agent/hooks/hooks.json` (project-level)
 * 2. Installed plugins (via PluginLoader)
 */
export class HookRegistry {
    private hooks: Map<HookEvent, HookDefinition[]> = new Map();
    private runner: HookRunner;

    constructor() {
        this.runner = new HookRunner();
        // Initialize all event buckets
        for (const event of ALL_HOOK_EVENTS) {
            this.hooks.set(event, []);
        }
    }

    /**
     * Register a hook for a specific event
     */
    register(event: HookEvent, hook: HookDefinition): void {
        if (!ALL_HOOK_EVENTS.includes(event)) {
            throw new Error(`Unknown hook event: "${event}". Valid events: ${ALL_HOOK_EVENTS.join(', ')}`);
        }
        const list = this.hooks.get(event) ?? [];
        list.push(hook);
        this.hooks.set(event, list);
    }

    /**
     * Load hooks from a hooks.json file
     */
    async loadFromFile(filePath: string, source?: string): Promise<number> {
        try {
            await access(filePath);
        } catch {
            return 0; // File doesn't exist — not an error
        }

        const content = await readFile(filePath, 'utf-8');
        const parsed = JSON.parse(content);
        let count = 0;

        const hooksObj = parsed.hooks ?? parsed;

        for (const [eventName, definitions] of Object.entries(hooksObj)) {
            if (!ALL_HOOK_EVENTS.includes(eventName as HookEvent)) {
                console.warn(`Ignoring unknown hook event: "${eventName}"`);
                continue;
            }

            const defs = definitions as HookDefinition[];
            for (const def of defs) {
                this.register(eventName as HookEvent, {
                    ...def,
                    source: source ?? 'project',
                });
                count++;
            }
        }

        return count;
    }

    /**
     * Load hooks from the default project location
     */
    async loadProjectHooks(projectRoot: string): Promise<number> {
        const hooksPath = path.join(projectRoot, '.agent', 'hooks', 'hooks.json');
        return this.loadFromFile(hooksPath, 'project');
    }

    /**
     * Dispatch an event — runs all matching hooks
     */
    async dispatch(ctx: HookContext): Promise<HookResult[]> {
        const definitions = this.hooks.get(ctx.event) ?? [];
        if (definitions.length === 0) return [];

        const results: HookResult[] = [];

        for (const hook of definitions) {
            // Check match filter
            if (hook.match && ctx.name) {
                const matchPattern = new RegExp(hook.match);
                if (!matchPattern.test(ctx.name)) {
                    continue;
                }
            }

            const result = await this.runner.execute(hook, ctx);
            results.push(result);

            // If blocking hook failed, stop processing
            if (hook.blocking && !result.success) {
                break;
            }
        }

        return results;
    }

    /**
     * List all registered hooks
     */
    list(): { event: HookEvent; hooks: HookDefinition[] }[] {
        const result: { event: HookEvent; hooks: HookDefinition[] }[] = [];
        for (const [event, hooks] of Array.from(this.hooks)) {
            if (hooks.length > 0) {
                result.push({ event, hooks });
            }
        }
        return result;
    }

    /**
     * Get count of registered hooks
     */
    get size(): number {
        let total = 0;
        for (const hooks of Array.from(this.hooks.values())) {
            total += hooks.length;
        }
        return total;
    }

    /**
     * Clear all hooks (useful for testing)
     */
    clear(): void {
        for (const event of ALL_HOOK_EVENTS) {
            this.hooks.set(event, []);
        }
    }
}
