import { z } from 'zod';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ToolDefinition } from '../types.js';

const execFileAsync = promisify(execFile);

// ─── Shared CLI Tool Factory ───

interface CLIToolConfig {
    name: string;
    binary: string;
    description: string;
    /** How to construct the CLI command from the prompt */
    buildArgs: (input: { prompt: string; files?: string[]; cwd?: string }) => string[];
    /** Timeout in ms (default: 120s for AI CLIs) */
    timeout?: number;
}

function createCLITool(config: CLIToolConfig): ToolDefinition {
    return {
        name: config.name,
        category: 'cli',
        description: config.description,
        inputSchema: z.object({
            prompt: z.string().describe('The task or prompt to send to the CLI agent'),
            files: z.array(z.string()).optional().describe('Optional file paths to scope the task'),
            cwd: z.string().optional().describe('Working directory'),
            timeout: z.number().optional().default(config.timeout ?? 120_000),
        }),
        outputSchema: z.object({
            stdout: z.string(),
            stderr: z.string(),
            exitCode: z.number(),
        }),
        permissions: ['exec'],
        timeout: config.timeout ?? 120_000,
        async execute(rawInput, ctx) {
            const input = rawInput as { prompt: string; files?: string[]; cwd?: string; timeout?: number };
            const workDir = input.cwd ?? ctx.cwd;

            try {
                const args = config.buildArgs(input);
                const { stdout, stderr } = await execFileAsync(
                    config.binary,
                    args,
                    {
                        cwd: workDir,
                        timeout: input.timeout,
                        maxBuffer: 50 * 1024 * 1024, // 50MB — AI CLIs can be verbose
                        env: { ...process.env },
                        shell: true,
                    }
                );

                return {
                    success: true,
                    data: {
                        stdout: stdout.toString(),
                        stderr: stderr.toString(),
                        exitCode: 0,
                    },
                    durationMs: 0,
                };
            } catch (err) {
                const error = err as { stdout?: string; stderr?: string; code?: number; message?: string };
                return {
                    success: false,
                    data: {
                        stdout: error.stdout?.toString() ?? '',
                        stderr: error.stderr?.toString() ?? '',
                        exitCode: error.code ?? 1,
                    },
                    error: error.message ?? `${config.name} execution failed`,
                    durationMs: 0,
                };
            }
        },
    };
}

// ─── Cursor CLI ───
export const cursorCLI = createCLITool({
    name: 'cli.cursor',
    binary: 'cursor',
    description: 'Delegate a coding task to Cursor CLI (uses native codebase context for multi-file refactoring)',
    buildArgs: (input) => {
        const args = ['--prompt', input.prompt];
        if (input.files && input.files.length > 0) {
            args.push('--files', input.files.join(','));
        }
        return args;
    },
    timeout: 300_000, // 5 min for complex refactors
});

// ─── Codex CLI ───
export const codexCLI = createCLITool({
    name: 'cli.codex',
    binary: 'codex',
    description: 'Delegate a coding task to OpenAI Codex CLI (code generation with sandbox execution)',
    buildArgs: (input) => {
        const args = [input.prompt];
        return args;
    },
    timeout: 180_000,
});

// ─── Gemini CLI ───
export const geminiCLI = createCLITool({
    name: 'cli.gemini',
    binary: 'gemini',
    description: 'Delegate a task to Gemini CLI (large-context analysis and reasoning)',
    buildArgs: (input) => {
        const args = ['-p', input.prompt];
        return args;
    },
    timeout: 180_000,
});

// ─── Claude CLI ───
export const claudeCLI = createCLITool({
    name: 'cli.claude',
    binary: 'claude',
    description: 'Delegate a coding task to Claude CLI (careful code review and generation)',
    buildArgs: (input) => {
        const args: string[] = ['-p', input.prompt];
        return args;
    },
    timeout: 180_000,
});

// ─── Export all CLI tools ───
export const cliTools = [cursorCLI, codexCLI, geminiCLI, claudeCLI];
