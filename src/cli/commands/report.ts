import { Command } from 'commander';
import chalk from 'chalk';
import { ReportGenerator } from '../../reporting/generator.js';

export function createReportCommand(): Command {
    const cmd = new Command('report')
        .description('Generate activity reports');

    // ─── Generate daily report ───
    cmd
        .command('generate')
        .description('Generate a daily report of agent activity')
        .option('--date <date>', 'Date (YYYY-MM-DD)', new Date().toISOString().split('T')[0])
        .option('--summary', 'Generate an AI executive summary')
        .action(async (opts: { date: string; summary?: boolean }) => {
            const date = new Date(opts.date);
            const generator = new ReportGenerator(process.cwd());

            console.log(chalk.gray(`\nGenerating report for ${opts.date}...\n`));

            try {
                let report: string;
                if (opts.summary) {
                    report = await generator.generateExecutiveSummary();
                } else {
                    report = await generator.generateDailyReport(date);
                }

                console.log(chalk.white(report));
                console.log();
            } catch (err) {
                console.error(chalk.red(`\n✗ Failed to generate report: ${(err as Error).message}\n`));
            }
        });

    return cmd;
}
