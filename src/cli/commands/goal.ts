import { Command } from 'commander';
import chalk from 'chalk';
import { MemoryStore } from '../../memory/store.js';
import { GoalStore } from '../../goals/store.js';
import { GoalDecomposer } from '../../goals/decomposer.js';
import { TaskExecutor } from '../../goals/executor.js';
import { ConfigLoader } from '../../config/loader.js';
import { LLMRouter } from '../../llm/router.js';

function getStores() {
    const mem = MemoryStore.open(process.cwd());
    const goals = new GoalStore(mem);
    return { mem, goals };
}

function progressBar(progress: number, width = 20): string {
    const filled = Math.round(progress * width);
    const empty = width - filled;
    const bar = '█'.repeat(filled) + '░'.repeat(empty);
    const pct = Math.round(progress * 100);
    return `${bar} ${pct}%`;
}

function statusIcon(status: string): string {
    switch (status) {
        case 'active': return '🔄';
        case 'completed': return '✅';
        case 'failed': return '❌';
        case 'paused': return '⏸️';
        case 'cancelled': return '🚫';
        case 'pending': return '⏳';
        case 'queued': return '📋';
        case 'running': return '🔄';
        case 'blocked': return '🚧';
        default: return '❓';
    }
}

export function createGoalCommand(): Command {
    const cmd = new Command('goal')
        .description('Manage autonomous goals and tasks');

    // ─── Add a goal ───
    cmd
        .command('add <title>')
        .description('Add a new goal for the agent to accomplish')
        .option('-d, --description <desc>', 'Detailed description')
        .option('-p, --priority <n>', 'Priority 1-10 (1=critical)', '5')
        .option('--deadline <date>', 'Deadline (ISO date format)')
        .action(async (title: string, opts: {
            description?: string;
            priority: string;
            deadline?: string;
        }) => {
            const { goals } = getStores();
            const goal = goals.addGoal(title, {
                description: opts.description,
                priority: parseInt(opts.priority),
                deadline: opts.deadline,
            });

            console.log(chalk.green(`\n✓ Goal #${goal.id} created`));
            console.log(chalk.white.bold(`  ${goal.title}`));
            if (goal.description) console.log(chalk.dim(`  ${goal.description}`));
            console.log(chalk.dim(`  Priority: ${goal.priority}/10`));
            if (goal.deadline) console.log(chalk.dim(`  Deadline: ${goal.deadline}`));
            console.log(chalk.dim(`\n  Add tasks: agent goal task ${goal.id} "task description"\n`));
        });

    // ─── List goals ───
    cmd
        .command('list')
        .description('List all goals')
        .option('-s, --status <status>', 'Filter by status: active|paused|completed|failed')
        .action(async (opts: { status?: string }) => {
            const { goals } = getStores();
            const allGoals = goals.listGoals(opts.status as any);

            if (allGoals.length === 0) {
                console.log(chalk.yellow('\nNo goals found.'));
                console.log(chalk.dim('  Create one: agent goal add "Your goal"\n'));
                return;
            }

            console.log(chalk.bold.cyan('\n🎯 Goals\n'));
            for (const goal of allGoals) {
                const tasks = goals.listTasks(goal.id);
                const completed = tasks.filter(t => t.status === 'completed').length;

                console.log(
                    `  ${statusIcon(goal.status)} ` +
                    `${chalk.dim(`#${goal.id}`)} ` +
                    chalk.white.bold(goal.title) +
                    ` ${chalk.dim(`[P${goal.priority}]`)}`
                );
                console.log(
                    `    ${progressBar(goal.progress)} ` +
                    chalk.dim(`(${completed}/${tasks.length} tasks)`)
                );
                if (goal.deadline) {
                    console.log(chalk.dim(`    ⏰ Deadline: ${goal.deadline}`));
                }
                console.log();
            }
        });

    // ─── Goal status (detailed) ───
    cmd
        .command('status [goalId]')
        .description('Show detailed goal status with tasks')
        .action(async (goalId?: string) => {
            const { goals } = getStores();

            if (goalId) {
                // Show specific goal
                const goal = goals.getGoal(parseInt(goalId));
                if (!goal) {
                    console.error(chalk.red(`\n✗ Goal #${goalId} not found\n`));
                    return;
                }

                const tasks = goals.listTasks(goal.id);

                console.log(chalk.bold.cyan(`\n🎯 ${goal.title}\n`));
                console.log(`  ${chalk.dim('Status:')}   ${statusIcon(goal.status)} ${goal.status}`);
                console.log(`  ${chalk.dim('Priority:')} ${goal.priority}/10`);
                console.log(`  ${chalk.dim('Progress:')} ${progressBar(goal.progress)}`);
                if (goal.deadline) console.log(`  ${chalk.dim('Deadline:')} ${goal.deadline}`);
                if (goal.description) console.log(`  ${chalk.dim('Details:')}  ${goal.description}`);
                console.log();

                if (tasks.length > 0) {
                    console.log(chalk.bold('  Tasks:'));
                    for (const task of tasks) {
                        const icon = statusIcon(task.status);
                        const skillTag = task.skill ? chalk.blue(` [${task.skill}]`) : '';
                        const approval = task.requires_approval && !task.approved_at
                            ? chalk.yellow(' 🛡️ needs approval')
                            : '';

                        console.log(
                            `    ${icon} ${chalk.dim(`#${task.id}`)} ` +
                            chalk.white(task.title) +
                            skillTag +
                            approval
                        );

                        if (task.error) {
                            console.log(chalk.red(`      Error: ${task.error}`));
                        }
                        if (task.output) {
                            const preview = task.output.slice(0, 80);
                            console.log(chalk.dim(`      Output: ${preview}${task.output.length > 80 ? '...' : ''}`));
                        }
                    }
                } else {
                    console.log(chalk.dim('  No tasks yet.'));
                    console.log(chalk.dim(`  Add: agent goal task ${goal.id} "task description"`));
                }
                console.log();
            } else {
                // Show overview dashboard
                const stats = goals.stats();
                const activeGoals = goals.listGoals('active');

                console.log(chalk.bold.cyan('\n📊 Agent Status Dashboard\n'));
                console.log(`  ${chalk.dim('Active Goals:')}      ${stats.activeGoals}`);
                console.log(`  ${chalk.dim('Completed Goals:')}   ${stats.completedGoals}`);
                console.log(`  ${chalk.dim('Pending Tasks:')}     ${stats.pendingTasks}`);
                console.log(`  ${chalk.dim('Running Tasks:')}     ${stats.runningTasks}`);
                console.log(`  ${chalk.dim('Awaiting Approval:')} ${stats.awaitingApproval}`);
                console.log();

                if (activeGoals.length > 0) {
                    console.log(chalk.bold('  Active Goals:'));
                    for (const goal of activeGoals) {
                        console.log(
                            `    ${chalk.dim(`#${goal.id}`)} ` +
                            chalk.white.bold(goal.title) +
                            ` ${progressBar(goal.progress, 15)}`
                        );
                    }
                    console.log();
                }

                const approvals = goals.getPendingApprovals();
                if (approvals.length > 0) {
                    console.log(chalk.bold.yellow('  ⚠️ Awaiting Your Approval:'));
                    for (const task of approvals) {
                        console.log(
                            `    🛡️ ${chalk.dim(`#${task.id}`)} ` +
                            chalk.white(task.title) +
                            chalk.dim(` (Goal #${task.goal_id})`)
                        );
                    }
                    console.log(chalk.dim('    Approve: agent approve <task-id>'));
                    console.log();
                }
            }
        });

    // ─── Add task to goal ───
    cmd
        .command('task <goalId> <title>')
        .description('Add a task to a goal')
        .option('-s, --skill <skill>', 'Skill to use for this task')
        .option('--depends <ids>', 'Comma-separated task IDs this depends on')
        .option('--approval', 'Requires human approval before execution')
        .action(async (goalId: string, title: string, opts: {
            skill?: string;
            depends?: string;
            approval?: boolean;
        }) => {
            const { goals } = getStores();
            const goal = goals.getGoal(parseInt(goalId));
            if (!goal) {
                console.error(chalk.red(`\n✗ Goal #${goalId} not found\n`));
                return;
            }

            const dependsOn = opts.depends
                ? opts.depends.split(',').map(id => parseInt(id.trim()))
                : [];

            const task = goals.addTask(parseInt(goalId), title, {
                skill: opts.skill,
                dependsOn,
                requiresApproval: opts.approval ?? false,
            });

            console.log(chalk.green(`\n✓ Task #${task.id} added to Goal #${goalId}`));
            console.log(chalk.white(`  ${title}`));
            if (opts.skill) console.log(chalk.dim(`  Skill: ${opts.skill}`));
            if (dependsOn.length > 0) console.log(chalk.dim(`  Depends on: ${dependsOn.join(', ')}`));
            if (opts.approval) console.log(chalk.yellow(`  ⚠️ Requires human approval`));
            console.log();
        });

    // ─── Pause/Resume/Cancel goal ───
    cmd
        .command('pause <goalId>')
        .description('Pause an active goal')
        .action(async (goalId: string) => {
            const { goals } = getStores();
            goals.updateGoalStatus(parseInt(goalId), 'paused');
            console.log(chalk.yellow(`\n⏸️ Goal #${goalId} paused\n`));
        });

    cmd
        .command('resume <goalId>')
        .description('Resume a paused goal')
        .action(async (goalId: string) => {
            const { goals } = getStores();
            goals.updateGoalStatus(parseInt(goalId), 'active');
            console.log(chalk.green(`\n▶️ Goal #${goalId} resumed\n`));
        });

    cmd
        .command('cancel <goalId>')
        .description('Cancel a goal')
        .action(async (goalId: string) => {
            const { goals } = getStores();
            goals.updateGoalStatus(parseInt(goalId), 'cancelled');
            console.log(chalk.red(`\n🚫 Goal #${goalId} cancelled\n`));
        });

    // ─── Decompose goal ───
    cmd
        .command('decompose <goalId>')
        .description('Decompose a goal into tasks using AI')
        .action(async (goalId: string) => {
            const { mem, goals } = getStores();
            const goal = goals.getGoal(parseInt(goalId));

            if (!goal) {
                console.error(chalk.red(`\n✗ Goal #${goalId} not found\n`));
                return;
            }

            console.log(chalk.yellow(`\n🤖 Analyzing goal: "${goal.title}"...`));

            try {
                const configLoader = new ConfigLoader();
                const config = await configLoader.load();
                const llm = new LLMRouter(config);
                const decomposer = new GoalDecomposer(llm, mem, goals);

                const tasks = await decomposer.decomposeAndCreate(goal);

                console.log(chalk.green(`\n✓ Goal decomposed into ${tasks.length} tasks:`));
                for (const task of tasks) {
                    const skillTag = task.skill ? chalk.blue(` [${task.skill}]`) : '';
                    console.log(
                        `  ${chalk.dim(`#${task.id}`)} ${chalk.white(task.title)}${skillTag}`
                    );
                }
                console.log();
            } catch (err) {
                console.error(chalk.red(`\n✗ Decomposition failed: ${(err as Error).message}\n`));
            }
        });

    // ─── Run tasks ───
    cmd
        .command('run')
        .description('Execute pending tasks for active goals')
        .option('-n, --max <n>', 'Max tasks to run', '5')
        .action(async (opts: { max: string }) => {
            const { mem, goals } = getStores();

            try {
                const configLoader = new ConfigLoader();
                const config = await configLoader.load();
                const llm = new LLMRouter(config);
                const executor = new TaskExecutor(llm, mem, goals);

                console.log(chalk.yellow('\n⚙️  Processing task queue...\n'));

                const result = await executor.processQueue(parseInt(opts.max));

                if (result.processed === 0) {
                    console.log(chalk.dim('  No pending tasks found.\n'));
                    return;
                }

                for (const res of result.results) {
                    if (res.success) {
                        console.log(chalk.green(`  ✓ Task #${res.taskId}: ${res.title}`));
                        console.log(chalk.dim(`    → ${res.output.split('\n')[0]}`));
                    } else {
                        console.log(chalk.red(`  ✗ Task #${res.taskId}: ${res.title}`));
                        console.log(chalk.dim(`    → ${res.output}`));
                    }
                }

                console.log(chalk.dim(`\n  Processed: ${result.processed}, Completed: ${result.completed}, Failed: ${result.failed}\n`));
            } catch (err) {
                console.error(chalk.red(`\n✗ Execution failed: ${(err as Error).message}\n`));
            }
        });

    return cmd;
}

/**
 * Standalone approve command (registered at top level: agent approve <id>)
 */
export function createApproveCommand(): Command {
    return new Command('approve')
        .argument('<taskId>', 'Task ID to approve')
        .description('Approve a task that requires human authorization')
        .action(async (taskId: string) => {
            const { goals } = getStores();
            const approved = goals.approveTask(parseInt(taskId));

            if (approved) {
                console.log(chalk.green(`\n✅ Task #${taskId} approved and queued for execution\n`));
            } else {
                console.error(chalk.red(`\n✗ Task #${taskId} not found or doesn't require approval\n`));
            }
        });
}
