import { MemoryStore } from '../memory/store.js';
import { GoalStore } from '../goals/store.js';
import { ConfigLoader } from '../config/loader.js';
import { LLMRouter } from '../llm/router.js';

export class ReportGenerator {
    private memoryStore: MemoryStore;
    private goalStore: GoalStore;

    constructor(workDir: string = process.cwd()) {
        this.memoryStore = MemoryStore.open(workDir);
        this.goalStore = new GoalStore(this.memoryStore);
    }

    /**
     * Generate a daily standup/activity report
     */
    async generateDailyReport(date: Date = new Date()): Promise<string> {
        const activity = this.memoryStore.getDailyActivity(date);

        // Group by type
        const tasksCompleted = activity.filter(a => a.event_type === 'task.completed');
        const tasksFailed = activity.filter(a => a.event_type === 'task.failed');
        const goalsCreated = activity.filter(a => a.event_type === 'goal.created');
        const memoriesSaved = activity.filter(a => a.event_type === 'memory.save');
        const triggerFires = activity.filter(a => a.event_type === 'trigger.fired'); // Assuming I log this later

        const dateStr = date.toISOString().split('T')[0];

        // Basic stats
        let report = `# 📝 Agent Daily Report: ${dateStr}\n\n`;

        report += `## 📊 Summary\n`;
        report += `- **Tasks Completed:** ${tasksCompleted.length}\n`;
        report += `- **Tasks Failed:** ${tasksFailed.length}\n`;
        report += `- **New Goals:** ${goalsCreated.length}\n`;
        report += `- **Memories Learned:** ${memoriesSaved.length}\n`;

        if (tasksCompleted.length > 0) {
            report += `\n## ✅ Completed Tasks\n`;
            for (const t of tasksCompleted) {
                // Fetch task details if possible (details column holds title/id)
                // "Task #1 completed"
                report += `- ${t.details}\n`;
            }
        }

        if (tasksFailed.length > 0) {
            report += `\n## ❌ Failures & Blockers\n`;
            for (const t of tasksFailed) {
                report += `- ${t.details}\n`;
            }
        }

        if (goalsCreated.length > 0) {
            report += `\n## 🎯 New Goals\n`;
            for (const g of goalsCreated) {
                report += `- ${g.details}\n`;
            }
        }

        // Add active goals status
        const activeGoals = this.goalStore.listGoals('active');
        if (activeGoals.length > 0) {
            report += `\n## 🔄 Active Goals Progress\n`;
            for (const goal of activeGoals) {
                const pct = Math.round(goal.progress * 100);
                report += `- **${goal.title}**: ${pct}% complete (Priority: ${goal.priority})\n`;
            }
        }

        return report;
    }

    /**
     * Generate an executive summary using LLM
     */
    async generateExecutiveSummary(): Promise<string> {
        const rawReport = await this.generateDailyReport();

        try {
            const configLoader = new ConfigLoader();
            const config = await configLoader.load();
            const llm = new LLMRouter(config);

            const response = await llm.chat({
                messages: [
                    {
                        role: 'system',
                        content: 'You are an executive assistant. Summarize the following technical activity log into a brief, professional daily email update for a manager. Focus on progress and blockers. Keep it under 200 words.'
                    },
                    {
                        role: 'user',
                        content: rawReport
                    }
                ],
                maxTokens: 500,
                temperature: 0.3
            });

            return response.content;
        } catch {
            return "Unable to generate executive summary (LLM unavailable). See full report below.\n\n" + rawReport;
        }
    }
}
