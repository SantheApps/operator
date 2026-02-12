import { Command } from 'commander';
import chalk from 'chalk';
import { MemoryStore } from '../../memory/store.js';

export function createMemoryCommand(): Command {
    const cmd = new Command('memory')
        .description('Manage agent persistent memory');

    // ─── Save a memory ───
    cmd
        .command('save <content>')
        .description('Save a memory (fact, preference, or project context)')
        .option('-c, --category <cat>', 'Category: project|preference|fact|learned|general', 'general')
        .option('-t, --tags <tags>', 'Comma-separated tags', '')
        .action(async (content: string, opts: { category: string; tags: string }) => {
            const store = MemoryStore.open(process.cwd());
            const tags = opts.tags ? opts.tags.split(',').map(t => t.trim()) : [];
            const memory = store.save(content, opts.category as any, 'user', tags);

            console.log(chalk.green(`\n✓ Memory saved (ID: ${memory.id})`));
            console.log(chalk.dim(`  Category: ${memory.category}`));
            if (tags.length > 0) console.log(chalk.dim(`  Tags: ${tags.join(', ')}`));
            console.log(chalk.dim(`  Content: ${memory.content}\n`));
        });

    // ─── Search memories ───
    cmd
        .command('search <query>')
        .description('Search memories using full-text search')
        .option('-l, --limit <n>', 'Max results', '10')
        .action(async (query: string, opts: { limit: string }) => {
            const store = MemoryStore.open(process.cwd());
            const results = store.search(query, parseInt(opts.limit));

            if (results.length === 0) {
                console.log(chalk.yellow(`\nNo memories found matching "${query}"\n`));
                return;
            }

            console.log(chalk.bold.cyan(`\n🧠 Memories matching "${query}":\n`));
            for (const mem of results) {
                console.log(
                    `  ${chalk.dim(`#${mem.id}`)} ` +
                    `${chalk.magenta(`[${mem.category}]`)} ` +
                    chalk.white(mem.content)
                );
                console.log(chalk.dim(`    Saved: ${mem.created_at} | Source: ${mem.source}`));
                if (mem.tags.length > 0) {
                    console.log(chalk.dim(`    Tags: ${mem.tags.join(', ')}`));
                }
                console.log();
            }
        });

    // ─── List all memories ───
    cmd
        .command('list')
        .description('List all saved memories')
        .option('-c, --category <cat>', 'Filter by category')
        .option('-l, --limit <n>', 'Max results', '20')
        .action(async (opts: { category?: string; limit: string }) => {
            const store = MemoryStore.open(process.cwd());
            const memories = store.list(opts.category as any, parseInt(opts.limit));

            if (memories.length === 0) {
                console.log(chalk.yellow('\nNo memories saved yet.'));
                console.log(chalk.dim('  Save one: agent memory save "some fact"\n'));
                return;
            }

            console.log(chalk.bold.cyan('\n🧠 Agent Memory\n'));
            for (const mem of memories) {
                console.log(
                    `  ${chalk.dim(`#${mem.id}`)} ` +
                    `${chalk.magenta(`[${mem.category}]`)} ` +
                    chalk.white(mem.content)
                );
                if (mem.tags.length > 0) {
                    console.log(chalk.dim(`    Tags: ${mem.tags.join(', ')}`));
                }
            }

            const stats = store.stats();
            console.log(chalk.dim(`\n  Total: ${stats.total} memories\n`));
        });

    // ─── Forget a memory ───
    cmd
        .command('forget <id>')
        .description('Delete a memory by ID')
        .action(async (id: string) => {
            const store = MemoryStore.open(process.cwd());
            const deleted = store.forget(parseInt(id));

            if (deleted) {
                console.log(chalk.green(`\n✓ Memory #${id} deleted\n`));
            } else {
                console.error(chalk.red(`\n✗ Memory #${id} not found\n`));
            }
        });

    // ─── Memory stats ───
    cmd
        .command('stats')
        .description('Show memory statistics')
        .action(async () => {
            const store = MemoryStore.open(process.cwd());
            const stats = store.stats();

            console.log(chalk.bold.cyan('\n📊 Memory Stats\n'));
            console.log(`  ${chalk.dim('Total:')}      ${stats.total}`);
            console.log(`  ${chalk.dim('By Category:')}`);
            for (const [cat, count] of Object.entries(stats.byCategory)) {
                console.log(`    ${chalk.magenta(cat)}: ${count}`);
            }
            console.log(`  ${chalk.dim('By Source:')}`);
            for (const [src, count] of Object.entries(stats.bySource)) {
                console.log(`    ${chalk.blue(src)}: ${count}`);
            }
            console.log();
        });

    return cmd;
}
