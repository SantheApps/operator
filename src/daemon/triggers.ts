import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';


/**
 * Trigger types supported by the daemon
 */
export interface TriggerConfig {
    name: string;
    enabled: boolean;
    event: 'file.changed' | 'cron' | 'webhook' | 'git.push' | 'goal.check';
    // For file.changed
    watch?: string | string[];
    debounce?: number;
    // For cron
    schedule?: string;
    // For webhook
    path?: string;
    secret?: string;
    // For git.push
    branch?: string;
    // Action to perform
    action: {
        skill?: string;
        run?: string;
        type?: string;
        input?: Record<string, any>;
        report?: boolean;
        block?: boolean;
    };
}

export interface TriggersFile {
    triggers: TriggerConfig[];
}

/**
 * Load triggers from .agent/triggers.yaml
 */
export async function loadTriggers(workDir?: string): Promise<TriggerConfig[]> {
    const dir = workDir ?? process.cwd();
    const triggersPath = path.join(dir, '.agent', 'triggers.yaml');

    try {
        const content = await readFile(triggersPath, 'utf-8');
        const parsed = parseYaml(content) as TriggersFile;

        if (!parsed?.triggers || !Array.isArray(parsed.triggers)) {
            return [];
        }

        return parsed.triggers
            .filter(t => t.enabled !== false)
            .map(t => ({
                ...t,
                enabled: t.enabled !== false,
                debounce: t.debounce ?? 2000,
            }));
    } catch {
        return [];
    }
}

/**
 * Get the default triggers template
 */
export function getDefaultTriggersYaml(): string {
    return `# Agent Daemon Triggers
# These define what the daemon watches and automates.
# Event types: file.changed, cron, webhook, git.push, goal.check

triggers:
  # Process the goal/task queue every 2 minutes
  - name: goal-processor
    event: goal.check
    schedule: "*/2 * * * *"
    enabled: true
    action:
      type: goal-progress

  # Daily standup report from git log
  # - name: morning-standup
  #   event: cron
  #   schedule: "0 9 * * 1-5"
  #   enabled: false
  #   action:
  #     skill: git-commit
  #     input:
  #       type: standup-report

  # Auto code-review on file changes
  # - name: auto-review
  #   event: file.changed
  #   watch: "src/**/*.ts"
  #   debounce: 5000
  #   enabled: false
  #   action:
  #     skill: code-review
  #     input:
  #       scope: changed-files

  # System health check every hour
  # - name: health-check
  #   event: cron
  #   schedule: "0 * * * *"
  #   enabled: false
  #   action:
  #     skill: system-monitor
  #     report: true
`;
}
