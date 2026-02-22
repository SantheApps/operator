import ora, { type Ora } from 'ora';
import chalk from 'chalk';

/**
 * Spinner wrapper for consistent UX across the CLI
 */
export class Spinner {
    private spinner: Ora;

    constructor() {
        this.spinner = ora({
            color: 'cyan',
            spinner: 'dots',
        });
    }

    /**
     * Start the spinner with a message
     */
    start(message: string): void {
        this.spinner.start(chalk.dim(`  ${message}`));
    }

    /**
     * Update spinner text
     */
    update(message: string): void {
        this.spinner.text = chalk.dim(`  ${message}`);
    }

    /**
     * Stop with success
     */
    success(message: string): void {
        this.spinner.succeed(chalk.green(`  ${message}`));
    }

    /**
     * Stop with failure
     */
    fail(message: string): void {
        this.spinner.fail(chalk.red(`  ${message}`));
    }

    /**
     * Stop with warning
     */
    warn(message: string): void {
        this.spinner.warn(chalk.yellow(`  ${message}`));
    }

    /**
     * Stop with info
     */
    info(message: string): void {
        this.spinner.info(chalk.dim(`  ${message}`));
    }

    /**
     * Stop the spinner (no status icon)
     */
    stop(): void {
        this.spinner.stop();
    }

    /**
     * Whether the spinner is active
     */
    get isSpinning(): boolean {
        return this.spinner.isSpinning;
    }
}
