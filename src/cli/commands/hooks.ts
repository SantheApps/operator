import { Command } from 'commander';
import chalk from 'chalk';
import { HookRegistry } from '../../hooks/registry.js';
import { ALL_HOOK_EVENTS } from '../../hooks/types.js';
import type { HookEvent } from '../../hooks/types.js';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

export function createHooksCommand(): Command {
    const cmd = new Command('hooks')
        .description('Manage lifecycle hooks');

    // ─── List hooks ───
    cmd.command('list')
        .description('List all registered hooks')
        .action(async () => {
            const registry = new HookRegistry();
            const count = await registry.loadProjectHooks(process.cwd());

            if (count === 0) {
                console.log(chalk.dim('No hooks registered.'));
                console.log(chalk.dim(`\nCreate hooks in ${chalk.white('.agent/hooks/hooks.json')}`));
                console.log(chalk.dim('\nAvailable events:'));
                for (const event of ALL_HOOK_EVENTS) {
                    console.log(chalk.dim(`  • ${event}`));
                }
                return;
            }

            console.log(chalk.bold(`\n🪝 Registered Hooks (${count})\n`));

            for (const { event, hooks } of registry.list()) {
                console.log(chalk.cyan.bold(`  ${event}`));
                for (const hook of hooks) {
                    const match = hook.match ? chalk.dim(` [match: ${hook.match}]`) : '';
                    const blocking = hook.blocking ? chalk.yellow(' ⚠ blocking') : '';
                    const source = chalk.dim(` (${hook.source ?? 'project'})`);
                    console.log(`    → ${chalk.white(hook.command)}${match}${blocking}${source}`);
                }
                console.log();
            }
        });

    // ─── Add a hook ───
    cmd.command('add')
        .description('Add a new hook')
        .argument('<event>', `Hook event (${ALL_HOOK_EVENTS.slice(0, 3).join(', ')}, ...)`)
        .argument('<command>', 'Shell command to execute')
        .option('-m, --match <pattern>', 'Regex pattern to filter by tool/skill name')
        .option('-b, --blocking', 'If set, hook failure aborts the operation')
        .option('-t, --timeout <ms>', 'Timeout in milliseconds', '10000')
        .action(async (event: string, command: string, options: { match?: string; blocking?: boolean; timeout?: string }) => {
            if (!ALL_HOOK_EVENTS.includes(event as HookEvent)) {
                console.error(chalk.red(`Unknown event: "${event}"`));
                console.log(chalk.dim(`Valid events: ${ALL_HOOK_EVENTS.join(', ')}`));
                process.exit(1);
            }

            const hooksDir = path.join(process.cwd(), '.agent', 'hooks');
            const hooksFile = path.join(hooksDir, 'hooks.json');

            // Load existing or create new
            let existing: Record<string, unknown[]> = {};
            try {
                const { readFile } = await import('node:fs/promises');
                const content = await readFile(hooksFile, 'utf-8');
                const parsed = JSON.parse(content);
                existing = parsed.hooks ?? parsed;
            } catch {
                // File doesn't exist yet
            }

            // Add the new hook
            if (!existing[event]) {
                existing[event] = [];
            }

            const hookDef: Record<string, unknown> = { command };
            if (options.match) hookDef.match = options.match;
            if (options.blocking) hookDef.blocking = true;
            if (options.timeout && options.timeout !== '10000') hookDef.timeout = parseInt(options.timeout, 10);

            (existing[event] as unknown[]).push(hookDef);

            // Write back
            await mkdir(hooksDir, { recursive: true });
            await writeFile(hooksFile, JSON.stringify({ hooks: existing }, null, 2) + '\n', 'utf-8');

            console.log(chalk.green(`✓ Hook added: ${event} → ${command}`));
        });

    // ─── Events reference ───
    cmd.command('events')
        .description('Show all available hook events')
        .action(() => {
            console.log(chalk.bold('\n🪝 Available Hook Events\n'));

            const groups: Record<string, { events: HookEvent[]; description: string }> = {
                'Engine': {
                    events: ['before:tool', 'after:tool'],
                    description: 'Fires around individual tool execution',
                },
                'Plan': {
                    events: ['before:plan', 'after:step', 'after:plan'],
                    description: 'Fires during plan execution',
                },
                'Skill': {
                    events: ['before:skill', 'after:skill'],
                    description: 'Fires around skill execution',
                },
                'Goal': {
                    events: ['after:decompose'],
                    description: 'Fires after goal decomposition',
                },
                'Session': {
                    events: ['session:start', 'session:end'],
                    description: 'Fires at session boundaries',
                },
            };

            for (const [group, info] of Object.entries(groups)) {
                console.log(chalk.cyan.bold(`  ${group}`));
                console.log(chalk.dim(`  ${info.description}`));
                for (const evt of info.events) {
                    console.log(`    • ${chalk.white(evt)}`);
                }
                console.log();
            }
        });

    return cmd;
}
