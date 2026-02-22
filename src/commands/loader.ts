import { readFile, readdir, access } from 'node:fs/promises';
import path from 'node:path';
import type { CommandDefinition } from './types.js';

/**
 * Command Loader — discovers and parses command .md files
 *
 * Commands are markdown files with YAML frontmatter:
 *
 * ```markdown
 * ---
 * name: deploy-staging
 * description: Deploy current branch to staging
 * tools: [cmd.run, git.status]
 * ---
 * # Deploy to Staging
 * 1. Run `npm test` to verify tests pass
 * 2. Run `npm run build`
 * 3. Push to staging branch
 * ```
 */
export class CommandLoader {
    private commands: Map<string, CommandDefinition> = new Map();

    /**
     * Load commands from a directory of .md files
     */
    async loadFromDirectory(dirPath: string, source = 'project'): Promise<number> {
        try {
            await access(dirPath);
        } catch {
            return 0; // Directory doesn't exist
        }

        const entries = await readdir(dirPath, { withFileTypes: true });
        let count = 0;

        for (const entry of entries) {
            if (!entry.isFile() || !entry.name.endsWith('.md')) continue;

            const filePath = path.join(dirPath, entry.name);
            const cmd = await this.parseCommandFile(filePath, source);

            if (cmd) {
                this.commands.set(cmd.name, cmd);
                count++;
            }
        }

        return count;
    }

    /**
     * Load commands from the default project location (.agent/commands/)
     */
    async loadProjectCommands(projectRoot: string): Promise<number> {
        const commandsDir = path.join(projectRoot, '.agent', 'commands');
        return this.loadFromDirectory(commandsDir, 'project');
    }

    /**
     * Parse a single command markdown file
     */
    private async parseCommandFile(filePath: string, source: string): Promise<CommandDefinition | null> {
        try {
            const content = await readFile(filePath, 'utf-8');
            const { frontmatter, body } = this.parseFrontmatter(content);

            if (!frontmatter.name) {
                // Default name from filename
                frontmatter.name = path.basename(filePath, '.md');
            }

            if (!frontmatter.description) {
                frontmatter.description = `Command: ${frontmatter.name}`;
            }

            return {
                name: frontmatter.name as string,
                description: frontmatter.description as string,
                tools: (frontmatter.tools as string[]) ?? [],
                prompt: body.trim(),
                path: filePath,
                source,
                tags: frontmatter.tags as string[] | undefined,
            };
        } catch (err) {
            console.error(`Failed to parse command at ${filePath}: ${(err as Error).message}`);
            return null;
        }
    }

    /**
     * Parse YAML frontmatter from markdown content
     */
    private parseFrontmatter(content: string): {
        frontmatter: Record<string, unknown>;
        body: string;
    } {
        const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
        if (!match) {
            return { frontmatter: {}, body: content };
        }

        const yamlStr = match[1];
        const body = match[2];

        // Simple YAML parser for frontmatter (handles key: value and key: [array])
        const frontmatter: Record<string, unknown> = {};
        for (const line of yamlStr.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;

            const colonIdx = trimmed.indexOf(':');
            if (colonIdx === -1) continue;

            const key = trimmed.slice(0, colonIdx).trim();
            let value: unknown = trimmed.slice(colonIdx + 1).trim();

            // Parse arrays: [item1, item2]
            if (typeof value === 'string' && value.startsWith('[') && value.endsWith(']')) {
                value = value.slice(1, -1).split(',').map(s => s.trim()).filter(Boolean);
            }

            frontmatter[key] = value;
        }

        return { frontmatter, body };
    }

    /**
     * Get a command by name
     */
    get(name: string): CommandDefinition | undefined {
        return this.commands.get(name);
    }

    /**
     * Check if a command exists
     */
    has(name: string): boolean {
        return this.commands.has(name);
    }

    /**
     * List all loaded commands
     */
    list(): CommandDefinition[] {
        return Array.from(this.commands.values());
    }

    /**
     * Get count of loaded commands
     */
    get size(): number {
        return this.commands.size;
    }
}
