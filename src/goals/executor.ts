import { LLMRouter } from '../llm/router.js';
import { MemoryStore } from '../memory/store.js';
import { GoalStore, type Task } from './store.js';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

/**
 * Task Executor — Runs individual tasks within goals
 *
 * Provides real execution via:
 * 1. LLM-guided skill execution (sends task + skill prompt to LLM)
 * 2. Direct shell command execution
 * 3. Compound multi-step execution
 */
export class TaskExecutor {
    constructor(
        private llm: LLMRouter,
        private memoryStore: MemoryStore,
        private goalStore: GoalStore,
        private workDir: string = process.cwd(),
    ) { }

    /**
     * Execute a single task
     */
    async execute(task: Task): Promise<{ success: boolean; output: string }> {
        // Mark as running
        this.goalStore.startTask(task.id);

        try {
            let result: { success: boolean; output: string };

            if (task.skill) {
                result = await this.executeWithSkill(task);
            } else {
                result = await this.executeWithLLM(task);
            }

            if (result.success) {
                this.goalStore.completeTask(task.id, result.output);

                // Save learnings for future context
                this.memoryStore.save(
                    `Task completed: "${task.title}" → ${result.output.slice(0, 300)}`,
                    'learned',
                    'agent',
                    ['task', 'execution', task.skill ?? 'general']
                );
            } else {
                this.goalStore.failTask(task.id, result.output);
            }

            return result;
        } catch (err) {
            const error = (err as Error).message;
            this.goalStore.failTask(task.id, error);
            return { success: false, output: error };
        }
    }

    /**
     * Execute task using an assigned skill
     */
    private async executeWithSkill(task: Task): Promise<{ success: boolean; output: string }> {
        const start = Date.now();

        // Gather context
        const memoryContext = this.memoryStore.getContext(task.title, 200);
        const goal = this.goalStore.getGoal(task.goal_id);

        const systemPrompt = `You are an autonomous agent executing a task as part of a larger goal.
You have the skill "${task.skill}" available.

Your job:
1. Analyze the task and determine the exact actions needed
2. Provide shell commands to execute (if applicable)
3. Report what was accomplished

Important:
- Be specific and actionable
- If you need to run commands, wrap them in \`\`\`bash blocks
- Report results clearly
- Working directory: ${this.workDir}

${memoryContext ? `\nRelevant context:\n${memoryContext}` : ''}`;

        const userPrompt = `Execute this task:

Task: ${task.title}
${task.description ? `Description: ${task.description}` : ''}
Skill: ${task.skill}
${goal ? `Parent Goal: ${goal.title}` : ''}
${Object.keys(task.input).length > 0 ? `Input: ${JSON.stringify(task.input)}` : ''}`;

        let success = true;
        let output = '';

        try {
            const response = await this.llm.chat({
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt },
                ],
                temperature: 0.2,
                maxTokens: 1500,
                skillName: task.skill ?? undefined,
            });

            // Extract and run any bash commands from the response
            const commands = this.extractCommands(response.content);
            const commandResults: string[] = [];

            for (const cmd of commands) {
                try {
                    const { stdout, stderr } = await execAsync(cmd, {
                        cwd: this.workDir,
                        timeout: 60_000,
                        env: { ...process.env },
                    });
                    commandResults.push(`$ ${cmd}\n${stdout.trim()}${stderr ? '\nstderr: ' + stderr.trim() : ''}`);
                } catch (err: any) {
                    success = false;
                    commandResults.push(`$ ${cmd}\nFailed: ${err.message}`);
                }
            }

            output = commands.length > 0
                ? `${response.content}\n\n--- Executed Commands ---\n${commandResults.join('\n\n')}`
                : response.content;

        } catch (err) {
            success = false;
            output = `LLM/Execution Error: ${(err as Error).message}`;
        }

        // Record metrics
        if (task.skill) {
            this.memoryStore.recordSkillMetric(task.skill, success, Date.now() - start);
        }

        return { success, output };
    }

    /**
     * Execute task directly with LLM reasoning (no specific skill)
     */
    private async executeWithLLM(task: Task): Promise<{ success: boolean; output: string }> {
        const memoryContext = this.memoryStore.getContext(task.title, 200);

        const response = await this.llm.chat({
            messages: [
                {
                    role: 'system',
                    content: `You are an autonomous agent. Analyze and execute the given task.
Provide clear, actionable results.
If shell commands are needed, wrap them in \`\`\`bash blocks.
Working directory: ${this.workDir}
${memoryContext ? `\nContext:\n${memoryContext}` : ''}`,
                },
                {
                    role: 'user',
                    content: `Execute: ${task.title}\n${task.description ?? ''}`,
                },
            ],
            temperature: 0.2,
            maxTokens: 1000,
        });

        return { success: true, output: response.content };
    }

    /**
     * Process the entire task queue for active goals
     */
    async processQueue(maxTasks = 5): Promise<{
        processed: number;
        completed: number;
        failed: number;
        results: Array<{ taskId: number; title: string; success: boolean; output: string }>;
    }> {
        let processed = 0;
        let completed = 0;
        let failed = 0;
        const results: Array<{ taskId: number; title: string; success: boolean; output: string }> = [];

        while (processed < maxTasks) {
            const task = this.goalStore.getNextTask();
            if (!task) break;

            processed++;
            const result = await this.execute(task);

            results.push({
                taskId: task.id,
                title: task.title,
                success: result.success,
                output: result.output.slice(0, 500),
            });

            if (result.success) {
                completed++;
            } else {
                failed++;
            }
        }

        return { processed, completed, failed, results };
    }

    /**
     * Extract bash commands from LLM response
     */
    private extractCommands(content: string): string[] {
        const commands: string[] = [];
        const regex = /```bash\n([\s\S]*?)```/g;
        let match;

        while ((match = regex.exec(content)) !== null) {
            const block = match[1].trim();
            // Split multi-line blocks into individual commands
            const lines = block.split('\n')
                .map(l => l.trim())
                .filter(l => l && !l.startsWith('#'));

            commands.push(...lines);
        }

        return commands;
    }
}
