import { MemoryStore } from '../memory/store.js';
import { GoalStore } from '../goals/store.js';
import { SkillLoader } from './loader.js';
import { LLMRouter } from '../llm/router.js';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface Diagnosis {
    skill: string;
    healthy: boolean;
    issues: string[];
    fixSuggestion?: string;
    logsanalyzed: number;
}

export class SkillDoctor {
    private goalStore: GoalStore;

    constructor(
        private memoryStore: MemoryStore,
        private skillLoader: SkillLoader,
        private llm: LLMRouter
    ) {
        this.goalStore = new GoalStore(memoryStore);
    }

    /**
     * Diagnose a specific skill based on recent performance
     */
    async diagnose(skillName: string): Promise<Diagnosis> {
        // 1. Check general metrics
        const metrics = this.memoryStore.getSkillMetrics().find(m => m.skill === skillName);
        const issues: string[] = [];

        if (metrics) {
            const rate = metrics.calls > 0 ? (metrics.successes / metrics.calls) : 1;
            if (rate < 0.5) issues.push(`Low success rate: ${Math.round(rate * 100)}%`);
            if (metrics.failures > 5) issues.push(`High failure count: ${metrics.failures}`);
        } else {
            return { skill: skillName, healthy: true, issues: ['No usage data'], logsanalyzed: 0 };
        }

        // 2. Analyze specific error logs
        const errors = this.goalStore.getSkillErrors(skillName, 5);
        if (errors.length > 0) {
            issues.push(...errors.slice(0, 3).map(e => `Recent error: ${e.slice(0, 100)}...`));
        }

        return {
            skill: skillName,
            healthy: issues.length === 0,
            issues,
            logsanalyzed: errors.length
        };
    }

    /**
     * Attempt to automatically fix a failing skill
     */
    async fix(skillName: string): Promise<{ success: boolean; patch?: string; reasoning?: string }> {
        const skill = this.skillLoader.get(skillName);
        if (!skill) {
            return { success: false, reasoning: `Skill "${skillName}" not found` };
        }

        // Only fix prompt-based skills for now
        if (!skill.promptContent) {
            return { success: false, reasoning: 'Can only auto-fix prompt-based (.md) skills' };
        }

        const errors = this.goalStore.getSkillErrors(skillName, 10);
        if (errors.length === 0) {
            return { success: false, reasoning: 'No error logs found to analyze' };
        }

        // Generate patch using LLM
        const prompt = `You are an expert AI Agent Skill Developer.
Your task is to fix a broken skill by updating its prompt definition.

Skill: ${skillName}
Description: ${skill.manifest.description}

Current Prompt Source:
\`\`\`markdown
${skill.promptContent}
\`\`\`

Recent runtime errors:
${errors.map(e => `- ${e}`).join('\n')}

Analyze the errors and the source code.
Most errors are due to hallucinated tools, bad JSON formatting, or unclear instructions.
Rewrite the ENTIRE prompt file content to fix these issues.
Maintain the original YAML frontmatter or structure if present, but improve the instructions/examples.

Respond ONLY with the new markdown content inside a \`\`\`markdown block.
Add a brief reasoning outside the block.
`;

        try {
            const response = await this.llm.chat({
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.2, // Low temp for code generation
                maxTokens: 2000
            });

            // Extract markdown block
            const match = response.content.match(/```markdown\n([\s\S]*?)```/);
            if (!match) {
                return { success: false, reasoning: 'LLM failed to generate valid markdown.' };
            }

            const newContent = match[1];
            const reasoning = response.content.replace(/```markdown\n[\s\S]*?```/, '').trim();

            // Apply the fix
            const entryPath = path.join(skill.path, skill.manifest.entrypoint);
            await writeFile(entryPath, newContent, 'utf-8');

            // Record this repair
            this.memoryStore.save(
                `Auto-fixed skill "${skillName}". Reasoning: ${reasoning}`,
                'learned',
                'auto',
                ['repair', skillName]
            );

            return { success: true, patch: newContent, reasoning };

        } catch (err) {
            return { success: false, reasoning: (err as Error).message };
        }
    }
}
