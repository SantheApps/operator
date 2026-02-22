#!/usr/bin/env node

import { createCLI } from '../src/cli/index.js';
import { startREPL } from '../src/cli/repl.js';

const program = createCLI();

// If no subcommand provided, launch interactive REPL
const args = process.argv.slice(2);
const hasSubcommand = args.length > 0 && !args[0].startsWith('-');

if (hasSubcommand) {
    program.parse(process.argv);
} else if (args.includes('--help') || args.includes('-h')) {
    program.parse(process.argv);
} else if (args.includes('--version') || args.includes('-V')) {
    program.parse(process.argv);
} else {
    // No subcommand → interactive mode
    startREPL().catch((err) => {
        console.error('Failed to start interactive mode:', err.message);
        process.exit(1);
    });
}
