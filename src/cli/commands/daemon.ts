import { Command } from 'commander';
import chalk from 'chalk';
import { DaemonManager } from '../../daemon/manager.js';
import { MemoryStore } from '../../memory/store.js';
import { GoalStore } from '../../goals/store.js';
import { loadTriggers, getDefaultTriggersYaml } from '../../daemon/triggers.js';
import { writeFile, access } from 'node:fs/promises';
import path from 'node:path';

export function createDaemonCommand(): Command {
    const cmd = new Command('daemon')
        .description('Manage the autonomous agent daemon');

    const manager = new DaemonManager();

    // ─── Start daemon ───
    cmd
        .command('start')
        .description('Start the autonomous agent daemon')
        .action(async () => {
            // Ensure triggers.yaml exists
            const triggersPath = path.join(process.cwd(), '.agent', 'triggers.yaml');
            try {
                await access(triggersPath);
            } catch {
                await writeFile(triggersPath, getDefaultTriggersYaml(), 'utf-8');
                console.log(chalk.dim('  Created .agent/triggers.yaml with defaults'));
            }

            try {
                const result = await manager.start();
                console.log(chalk.green(`\n✓ ${result.message}`));
                console.log(chalk.dim('  View logs:  agent daemon logs'));
                console.log(chalk.dim('  Status:     agent daemon status'));
                console.log(chalk.dim('  Stop:       agent daemon stop\n'));
            } catch (err) {
                console.error(chalk.red(`\n✗ Failed to start daemon: ${(err as Error).message}\n`));
                process.exit(1);
            }
        });

    // ─── Stop daemon ───
    cmd
        .command('stop')
        .description('Stop the agent daemon')
        .action(async () => {
            const result = await manager.stop();
            if (result.message.includes('not running')) {
                console.log(chalk.yellow(`\n○ ${result.message}\n`));
            } else {
                console.log(chalk.green(`\n✓ ${result.message}\n`));
            }
        });

    // ─── Status (full dashboard) ───
    cmd
        .command('status')
        .description('Show daemon and agent status dashboard')
        .action(async () => {
            const status = await manager.status();

            console.log(chalk.bold.cyan('\n🤖 Agent Daemon Status\n'));

            if (status.running) {
                console.log(`  ${chalk.green('●')} ${chalk.green('Running')} (PID: ${status.pid})`);
            } else {
                console.log(`  ${chalk.red('○')} ${chalk.yellow('Stopped')}`);
                console.log(chalk.dim('  Start with: agent daemon start\n'));
                return;
            }

            // Load triggers info
            const triggers = await loadTriggers(process.cwd());
            console.log(`  ${chalk.dim('Triggers:')}  ${triggers.length} active`);
            for (const t of triggers) {
                const eventIcon = t.event === 'cron' || t.event === 'goal.check'
                    ? '📅'
                    : t.event === 'file.changed'
                        ? '👁️'
                        : '🔗';
                console.log(chalk.dim(`    ${eventIcon} ${t.name} → ${t.schedule ?? t.watch ?? t.event}`));
            }

            // Show goal/task summary
            try {
                const mem = MemoryStore.open(process.cwd());
                const goals = new GoalStore(mem);
                const stats = goals.stats();

                console.log();
                console.log(`  ${chalk.dim('Goals:')}     ${stats.activeGoals} active, ${stats.completedGoals} completed`);
                console.log(`  ${chalk.dim('Tasks:')}     ${stats.pendingTasks} pending, ${stats.runningTasks} running, ${stats.completedTasks} done`);

                if (stats.awaitingApproval > 0) {
                    console.log(chalk.yellow(`  ${chalk.bold('⚠️  Approval:')} ${stats.awaitingApproval} task(s) waiting for your approval`));
                    console.log(chalk.dim('    Run: agent goal status'));
                }
            } catch {
                // No memory DB yet, that's fine
            }

            // Show recent logs
            const logs = await manager.getLogs(5);
            if (logs.length > 0 && logs[0] !== 'No daemon logs found.') {
                console.log();
                console.log(`  ${chalk.dim('Recent Activity:')}`);
                for (const line of logs) {
                    console.log(chalk.dim(`    ${line.replace(/^\[.*?\]\s*/, '')}`));
                }
            }

            console.log();
        });

    // ─── View logs ───
    cmd
        .command('logs')
        .description('View daemon activity logs')
        .option('-n, --lines <n>', 'Number of lines', '30')
        .option('-f, --follow', 'Follow log output (live tail)')
        .action(async (opts: { lines: string; follow?: boolean }) => {
            if (opts.follow) {
                // Live tail using child process
                const logPath = path.join(process.cwd(), '.agent', 'daemon.log');
                console.log(chalk.dim(`\n📜 Tailing ${logPath} (Ctrl+C to stop)\n`));

                const { spawn } = await import('node:child_process');
                const tail = spawn('tail', ['-f', '-n', opts.lines, logPath], {
                    stdio: 'inherit',
                });

                process.on('SIGINT', () => {
                    tail.kill();
                    process.exit(0);
                });
                return;
            }

            const logs = await manager.getLogs(parseInt(opts.lines));

            console.log(chalk.bold.cyan('\n📜 Daemon Logs\n'));
            for (const line of logs) {
                // Color-code by log level
                if (line.includes('✅') || line.includes('🟢')) {
                    console.log(chalk.green(`  ${line}`));
                } else if (line.includes('❌') || line.includes('🔴')) {
                    console.log(chalk.red(`  ${line}`));
                } else if (line.includes('⚡') || line.includes('💡')) {
                    console.log(chalk.yellow(`  ${line}`));
                } else {
                    console.log(chalk.dim(`  ${line}`));
                }
            }
            console.log();
        });

    // ─── Show triggers ───
    cmd
        .command('triggers')
        .description('Show configured daemon triggers')
        .action(async () => {
            const triggers = await loadTriggers(process.cwd());

            if (triggers.length === 0) {
                console.log(chalk.yellow('\nNo triggers configured.'));
                console.log(chalk.dim('  Create .agent/triggers.yaml to define triggers'));
                console.log(chalk.dim('  Or run: agent daemon start (creates default triggers)\n'));
                return;
            }

            console.log(chalk.bold.cyan('\n⚡ Daemon Triggers\n'));
            for (const t of triggers) {
                const icon = t.event === 'cron' || t.event === 'goal.check'
                    ? '📅'
                    : t.event === 'file.changed'
                        ? '👁️'
                        : t.event === 'webhook'
                            ? '🔗'
                            : '📡';

                console.log(
                    `  ${icon} ${chalk.white.bold(t.name)} ${chalk.dim(`[${t.event}]`)}` +
                    (t.enabled ? chalk.green(' ✓') : chalk.red(' ✗ disabled'))
                );

                if (t.schedule) console.log(chalk.dim(`    Schedule: ${t.schedule}`));
                if (t.watch) console.log(chalk.dim(`    Watch: ${Array.isArray(t.watch) ? t.watch.join(', ') : t.watch}`));
                if (t.action.skill) console.log(chalk.dim(`    Action: skill → ${t.action.skill}`));
                if (t.action.run) console.log(chalk.dim(`    Action: run → ${t.action.run}`));
                if (t.action.type) console.log(chalk.dim(`    Action: ${t.action.type}`));
                console.log();
            }
        });

    return cmd;
}
