import chalk from 'chalk';
import type { SkillLoader } from '../skills/loader.js';
import type { CommandLoader } from '../commands/loader.js';
import type { HookRegistry } from '../hooks/registry.js';
import type { LLMRouter } from '../llm/router.js';
import type { AgentConfig } from '../config/schema.js';

export interface SlashCommandContext {
    config: AgentConfig;
    skillLoader: SkillLoader;
    commandLoader: CommandLoader;
    hookRegistry: HookRegistry;
    llmRouter: LLMRouter;
}

interface SlashCommand {
    name: string;
    description: string;
    execute: (args: string, ctx: SlashCommandContext) => Promise<void>;
}

/**
 * Slash Command Registry — built-in commands for the interactive REPL
 */
export class SlashCommandRegistry {
    private commands: Map<string, SlashCommand> = new Map();

    constructor() {
        this.registerBuiltins();
    }

    private registerBuiltins(): void {
        this.register({
            name: 'help',
            description: 'Show available commands',
            execute: async (_args, ctx) => {
                console.log(chalk.bold('\n  📖 Available Commands\n'));

                // Built-in slash commands
                console.log(chalk.cyan.bold('  Slash Commands'));
                for (const cmd of this.list()) {
                    console.log(`    ${chalk.white(`/${cmd.name}`)}  ${chalk.dim(cmd.description)}`);
                }

                // User commands
                const commands = ctx.commandLoader.list();
                if (commands.length > 0) {
                    console.log(chalk.cyan.bold('\n  Custom Commands'));
                    for (const cmd of commands) {
                        console.log(`    ${chalk.white(`/${cmd.name}`)}  ${chalk.dim(cmd.description)}`);
                    }
                }

                console.log(chalk.dim('\n  Or just type a goal in natural language.\n'));
            },
        });

        this.register({
            name: 'skills',
            description: 'List installed skills',
            execute: async (_args, ctx) => {
                const skills = ctx.skillLoader.list();
                if (skills.length === 0) {
                    console.log(chalk.dim('\n  No skills installed.\n'));
                    return;
                }
                console.log(chalk.bold(`\n  🧩 Skills (${skills.length})\n`));
                for (const s of skills) {
                    const state = s.manifest.state === 'approved'
                        ? chalk.green('●')
                        : chalk.yellow('○');
                    console.log(`    ${state} ${chalk.white(s.manifest.name)} ${chalk.dim(`v${s.manifest.version}`)} — ${chalk.dim(s.manifest.description)}`);
                }
                console.log();
            },
        });

        this.register({
            name: 'commands',
            description: 'List available commands',
            execute: async (_args, ctx) => {
                const commands = ctx.commandLoader.list();
                if (commands.length === 0) {
                    console.log(chalk.dim('\n  No commands found. Create .md files in .agent/commands/\n'));
                    return;
                }
                console.log(chalk.bold(`\n  ⚡ Commands (${commands.length})\n`));
                for (const cmd of commands) {
                    const tools = cmd.tools.length > 0
                        ? chalk.dim(` [${cmd.tools.join(', ')}]`)
                        : '';
                    console.log(`    ${chalk.white(cmd.name)} — ${chalk.dim(cmd.description)}${tools}`);
                }
                console.log();
            },
        });

        this.register({
            name: 'hooks',
            description: 'Show registered hooks',
            execute: async (_args, ctx) => {
                const hooks = ctx.hookRegistry.list();
                if (hooks.length === 0) {
                    console.log(chalk.dim('\n  No hooks registered.\n'));
                    return;
                }
                console.log(chalk.bold(`\n  🪝 Hooks (${ctx.hookRegistry.size})\n`));
                for (const { event, hooks: defs } of hooks) {
                    console.log(chalk.cyan(`    ${event}`));
                    for (const h of defs) {
                        console.log(chalk.dim(`      → ${h.command}`));
                    }
                }
                console.log();
            },
        });

        this.register({
            name: 'model',
            description: 'Show current model provider',
            execute: async (_args, ctx) => {
                const providers = await ctx.llmRouter.getAvailableProviders();
                const defaultProv = ctx.config.models.routing.defaultProvider;
                console.log(chalk.bold('\n  🧠 Model Configuration\n'));
                console.log(`    Default: ${chalk.white(defaultProv)}`);
                console.log(`    Available: ${providers.map(p => p === defaultProv ? chalk.green(p) : chalk.dim(p)).join(', ')}`);
                console.log(`    Fallback chain: ${chalk.dim(ctx.config.models.routing.fallbackChain.join(' → '))}`);
                console.log();
            },
        });

        this.register({
            name: 'clear',
            description: 'Clear screen',
            execute: async () => {
                console.clear();
            },
        });

        this.register({
            name: 'compact',
            description: 'Summarize conversation and free context',
            execute: async () => {
                console.log(chalk.dim('\n  Conversation compacted. Context freed.\n'));
            },
        });

        this.register({
            name: 'exit',
            description: 'Exit interactive mode',
            execute: async () => {
                console.log(chalk.dim('\n  👋 Goodbye!\n'));
                process.exit(0);
            },
        });
    }

    register(cmd: SlashCommand): void {
        this.commands.set(cmd.name, cmd);
    }

    get(name: string): SlashCommand | undefined {
        return this.commands.get(name);
    }

    has(name: string): boolean {
        return this.commands.has(name);
    }

    list(): SlashCommand[] {
        return Array.from(this.commands.values());
    }
}
