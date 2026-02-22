/**
 * Command System — Types
 *
 * Commands are lightweight, reusable goal templates defined as markdown files.
 * Unlike Skills (which need skill.json, entrypoint, permissions), Commands
 * are just text files with YAML frontmatter that inject a system prompt
 * and optional tool restrictions into the LLM agentic loop.
 */

/**
 * Parsed command definition from a .md file
 */
export interface CommandDefinition {
    /** Unique command name (from frontmatter) */
    name: string;
    /** Human-readable description */
    description: string;
    /** Whitelist of tools this command can use (empty = all tools) */
    tools: string[];
    /** The markdown body used as system prompt for the LLM */
    prompt: string;
    /** Absolute path to the source .md file */
    path: string;
    /** Source: 'project' or plugin name */
    source: string;
    /** Optional tags for discoverability */
    tags?: string[];
}
