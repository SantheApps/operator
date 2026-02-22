/**
 * Hook System — Types
 *
 * Lifecycle hooks allow plugins and users to intercept agent execution
 * at well-defined points (before/after tool calls, plan steps, etc.).
 */

// ─── Hook Events ───

export type HookEvent =
    // Engine-level
    | 'before:tool'
    | 'after:tool'
    // Plan-level
    | 'before:plan'
    | 'after:step'
    | 'after:plan'
    // Skill-level
    | 'before:skill'
    | 'after:skill'
    // Goal-level
    | 'after:decompose'
    // Session-level
    | 'session:start'
    | 'session:end';

export const ALL_HOOK_EVENTS: HookEvent[] = [
    'before:tool', 'after:tool',
    'before:plan', 'after:step', 'after:plan',
    'before:skill', 'after:skill',
    'after:decompose',
    'session:start', 'session:end',
];

// ─── Hook Definition ───

export interface HookDefinition {
    /** Shell command to execute when the hook fires */
    command: string;
    /** Optional glob/regex to match against the event context (e.g., tool name) */
    match?: string;
    /** Working directory for the command (defaults to project root) */
    cwd?: string;
    /** Timeout in ms (default: 10000) */
    timeout?: number;
    /** If true, a hook failure aborts the parent operation */
    blocking?: boolean;
    /** Source plugin name (auto-set during plugin loading) */
    source?: string;
}

// ─── Hook Context ───

export interface HookContext {
    /** The event that triggered this hook */
    event: HookEvent;
    /** Name of the tool/skill/plan involved */
    name?: string;
    /** Input arguments */
    args?: Record<string, unknown>;
    /** Result of the operation (for "after" hooks) */
    result?: { success: boolean; output?: unknown; error?: string };
    /** Current working directory */
    cwd: string;
    /** Current run ID */
    runId?: string;
}

// ─── Hook Execution Result ───

export interface HookResult {
    hook: HookDefinition;
    event: HookEvent;
    success: boolean;
    stdout?: string;
    stderr?: string;
    error?: string;
    durationMs: number;
}
