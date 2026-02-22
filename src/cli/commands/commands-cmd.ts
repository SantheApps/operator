import { Command } from 'commander';
import chalk from 'chalk';
import { CommandLoader } from '../../commands/loader.js';

export function createCommandsCommand(): Command {
    const cmd = new Command('commands')
        .description('Manage lightweight commands');

    cmd.command('list')
        .description('List all available commands')
        .action(async () => {
            const loader = new CommandLoader();
            const count = await loader.loadProjectCommands(process.cwd());

            if (count === 0) {
                console.log(chalk.dim('No commands found.'));
                console.log(chalk.dim(`\nCreate commands in ${chalk.white('.agent/commands/')}`));
                console.log(chalk.dim('Each .md file with YAML frontmatter becomes a command.\n'));
                console.log(chalk.dim('Example:\n'));
                console.log(chalk.dim('  ---'));
                console.log(chalk.dim('  name: deploy-staging'));
                console.log(chalk.dim('  description: Deploy to staging'));
                console.log(chalk.dim('  tools: [cmd.run, git.status]'));
                console.log(chalk.dim('  ---'));
                console.log(chalk.dim('  # Steps...'));
                return;
            }

            console.log(chalk.bold(`\n⚡ Available Commands (${count})\n`));

            for (const command of loader.list()) {
                const tools = command.tools.length > 0
                    ? chalk.dim(` [${command.tools.join(', ')}]`)
                    : chalk.dim(' [all tools]');
                const source = chalk.dim(` (${command.source})`);

                console.log(`  ${chalk.cyan.bold(command.name)}${source}`);
                console.log(`    ${command.description}${tools}`);
                console.log();
            }

            console.log(chalk.dim(`  Run with: ${chalk.white('agent run <command-name>')}\n`));
        });

    return cmd;
}
