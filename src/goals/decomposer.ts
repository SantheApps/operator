import { LLMRouter } from '../llm/router.js';
import { MemoryStore } from '../memory/store.js';
import { GoalStore, type Goal, type Task } from './store.js';


/**
 * Goal Decomposition Engine
 *
 * Uses the LLM to break high-level goals into concrete,
 * executable tasks with dependencies and skill assignments.
 */

export interface DecomposedTask {
    title: string;
    description: string;
    skill?: string;
    dependsOnIndex?: number[];
    requiresApproval?: boolean;
    input?: Record<string, any>;
}

export interface DecompositionResult {
    tasks: DecomposedTask[];
    reasoning: string;
    estimatedMinutes: number;
}

/**
 * Available skills context for the LLM
 */
function getSkillsCatalog(): string {
    return `
Available skills the agent can use:
- code-review: Analyze code for bugs, style, and improvements
- git-commit: Stage, commit, and push changes using conventional commits
- docker-deploy: Build Docker images and deploy containers
- project-scaffold: Create new projects (React, Next.js, Express, etc.)
- npm-publish: Version bump, build, and publish npm packages
- system-monitor: Check CPU, memory, disk, and running processes
- log-analyzer: Parse and summarize log files for errors/patterns
- file-organizer: Sort and organize files by type/date/size
- web-search: Search the web for information
- create-note: Create markdown notes and documentation
- api-tester: Test HTTP endpoints with assertions
- db-query: Execute and explain database queries
- backup: Create timestamped backups of files/directories
- cron-scheduler: Schedule recurring tasks
- send-email: Send notification emails
- open-vscode: Open files/projects in VS Code
`.trim();
}

export class GoalDecomposer {
    constructor(
        private llm: LLMRouter,
        private memoryStore: MemoryStore,
        private goalStore: GoalStore,
    ) { }

    /**
     * Decompose a goal into tasks using the LLM
     */
    async decompose(goal: Goal): Promise<DecompositionResult> {
        // Gather context from memory
        const memoryContext = this.memoryStore.getContext(goal.title, 300);

        const systemPrompt = `You are an autonomous AI agent planner. Your job is to break down a high-level goal into specific, actionable tasks.

Rules:
1. Each task should be a single, concrete action
2. Assign the most appropriate skill to each task (from the catalog below)
3. Define dependencies between tasks (which tasks must complete first)
4. Flag any task that modifies production systems or has destructive effects as requiresApproval: true
5. Tasks should be ordered logically
6. Keep tasks focused — one action per task
7. Include a brief description for each task

${getSkillsCatalog()}

${memoryContext ? `\nRelevant context from agent memory:\n${memoryContext}` : ''}

Respond ONLY with valid JSON in this exact format:
{
  "reasoning": "Brief explanation of your decomposition strategy",
  "estimatedMinutes": <number>,
  "tasks": [
    {
      "title": "Short task title",
      "description": "What this task does",
      "skill": "skill-name or null",
      "dependsOnIndex": [0, 1],
      "requiresApproval": false,
      "input": {}
    }
  ]
}`;

        const userPrompt = `Decompose this goal into executable tasks:

Goal: ${goal.title}
${goal.description ? `Description: ${goal.description}` : ''}
${goal.deadline ? `Deadline: ${goal.deadline}` : ''}
Priority: ${goal.priority}/10`;

        const response = await this.llm.chat({
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt },
            ],
            temperature: 0.3,
            maxTokens: 2000,
        });

        // Parse the LLM response
        const parsed = this.parseResponse(response.content);

        return parsed;
    }

    /**
     * Decompose and immediately create tasks in the goal store
     */
    async decomposeAndCreate(goal: Goal): Promise<Task[]> {
        const result = await this.decompose(goal);
        const createdTasks: Task[] = [];

        // Map task indices to real task IDs for dependency resolution
        const indexToId: Map<number, number> = new Map();

        for (let i = 0; i < result.tasks.length; i++) {
            const taskDef = result.tasks[i];

            // Resolve dependencies from array indices to task IDs
            const dependsOn: number[] = [];
            if (taskDef.dependsOnIndex) {
                for (const depIdx of taskDef.dependsOnIndex) {
                    const depId = indexToId.get(depIdx);
                    if (depId !== undefined) {
                        dependsOn.push(depId);
                    }
                }
            }

            const task = this.goalStore.addTask(goal.id, taskDef.title, {
                description: taskDef.description,
                skill: taskDef.skill,
                input: taskDef.input,
                dependsOn,
                requiresApproval: taskDef.requiresApproval ?? false,
            });

            indexToId.set(i, task.id);
            createdTasks.push(task);
        }

        // Save the decomposition reasoning as a memory
        this.memoryStore.save(
            `Decomposed goal "${goal.title}" into ${createdTasks.length} tasks. ` +
            `Strategy: ${result.reasoning}. ` +
            `Estimated: ${result.estimatedMinutes} minutes.`,
            'learned',
            'agent',
            ['goal', 'decomposition', 'planning']
        );

        return createdTasks;
    }

    /**
     * Parse the LLM's JSON response robustly
     */
    private parseResponse(content: string): DecompositionResult {
        // Try to extract JSON from the response (handles markdown code blocks)
        let jsonStr = content;

        // Strip markdown code fences if present
        const jsonMatch = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
        if (jsonMatch) {
            jsonStr = jsonMatch[1];
        }

        try {
            const parsed = JSON.parse(jsonStr.trim());

            if (!Array.isArray(parsed.tasks)) {
                throw new Error('Response missing tasks array');
            }

            return {
                tasks: parsed.tasks.map((t: any) => ({
                    title: t.title ?? 'Unnamed task',
                    description: t.description ?? '',
                    skill: t.skill ?? undefined,
                    dependsOnIndex: t.dependsOnIndex ?? [],
                    requiresApproval: t.requiresApproval ?? false,
                    input: t.input ?? {},
                })),
                reasoning: parsed.reasoning ?? 'No reasoning provided',
                estimatedMinutes: parsed.estimatedMinutes ?? 30,
            };
        } catch (err) {
            // Fallback: create a single task from the goal
            return {
                tasks: [{
                    title: 'Execute goal manually',
                    description: `LLM decomposition failed. Original response: ${content.slice(0, 200)}`,
                    requiresApproval: true,
                }],
                reasoning: `Decomposition failed: ${(err as Error).message}`,
                estimatedMinutes: 60,
            };
        }
    }
}
