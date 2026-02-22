# The Plugin Ecosystem: Hooks, Commands & Extensibility (Part 6)

In **Parts 1-5**, we built an agent with a brain, body, memory, and self-healing. But it was a closed system.

In **v0.8.0**, we opened it up. Now anyone can extend the agent with **Plugins**, **Hooks**, and **Commands**—without touching core code.

## 🪝 Lifecycle Hooks

Hooks let you inject custom logic at every execution point. Think of them as Git hooks, but for your agent.

### The Events

| Event | When it fires |
|-------|--------------|
| `before:tool` | Before any tool executes |
| `after:tool` | After any tool completes |
| `before:plan` | Before a plan starts |
| `after:step` | After each plan step |
| `after:plan` | After a plan finishes |
| `before:skill` / `after:skill` | Around skill execution |
| `after:decompose` | After goal decomposition |
| `session:start` / `session:end` | At session boundaries |

### Example: Auto-Format on Write

Create `.agent/hooks/hooks.json`:
```json
{
  "hooks": {
    "after:tool": [
      {
        "match": "fs.write",
        "command": "npx prettier --write {{path}}",
        "blocking": false
      }
    ],
    "before:plan": [
      {
        "command": "./scripts/validate-env.sh",
        "blocking": true
      }
    ]
  }
}
```

Every time the agent writes a file, Prettier auto-formats it. Before every plan runs, your environment is validated.

### Template Variables

Hook commands support `{{name}}`, `{{event}}`, `{{cwd}}`, `{{path}}`, and `{{runId}}` placeholders. Environment variables like `AGENT_HOOK_EVENT` are also injected.

### CLI

```bash
agent hooks list              # Show all registered hooks
agent hooks add after:tool "npx prettier --write {{path}}" --match fs.write
agent hooks events            # Reference for all available events
```

---

## ⚡ Lightweight Commands

Skills require a `skill.json`, an entrypoint, and permission declarations. But sometimes you just want a quick recipe.

**Commands** are markdown files with YAML frontmatter. No boilerplate.

### Example: `deploy-staging.md`

Create `.agent/commands/deploy-staging.md`:
```markdown
---
name: deploy-staging
description: Deploy current branch to staging
tools: [cmd.run, git.status, git.diff]
---
# Deploy to Staging

You are deploying the current branch to staging.

Steps:
1. Run `npm test` to verify all tests pass
2. Run `npm run build` to create the production bundle
3. Run `git push origin HEAD:staging` to trigger deployment
4. Verify the deployment succeeded
```

### How It Works

When you run `agent run deploy-staging` or type `/deploy-staging` in interactive mode:
1. The runtime checks: Is there a **Skill** named `deploy-staging`? → No.
2. Is there a **Command** named `deploy-staging`? → **Yes!**
3. The command's markdown body becomes the LLM system prompt.
4. Only the whitelisted tools (`cmd.run`, `git.status`, `git.diff`) are available.

This gives you **scoped, repeatable tasks without any code**.

### CLI

```bash
agent commands list           # Show all available commands
agent run deploy-staging      # Run a command
agent run /deploy-staging     # Explicit slash-command syntax
```

---

## 🔧 Multi-CLI Orchestration

Sometimes, the best tool for a job isn't our agent—it's Cursor, Codex, or Claude CLI.

In v0.8.0, we added **first-class AI CLI wrappers** as tools. The LLM orchestrator can delegate sub-tasks to specialized CLIs:

| Tool | Wraps | Best For |
|------|-------|----------|
| `cli.cursor` | Cursor CLI | Multi-file refactoring with codebase context |
| `cli.codex` | OpenAI Codex | Code generation with sandbox execution |
| `cli.gemini` | Gemini CLI | Large-context analysis and reasoning |
| `cli.claude` | Claude CLI | Careful code review and generation |

### How It Works

These are standard `ToolDefinition` registrations—the LLM sees them alongside `fs.read`, `cmd.run`, and `git.diff`. When the task requires deep codebase understanding or parallel execution, the LLM can choose:

```
User: "Refactor the auth module to use JWT"
Agent LLM: "This needs multi-file refactoring with deep context."
→ Calls cli.cursor({ prompt: "Refactor auth to JWT...", files: ["src/auth/**"] })
→ Cursor CLI executes with native codebase indexing
→ Result returned to our agent for verification
```

Configure availability in `agent.config.json`:
```json
{
  "cliTools": {
    "cursor": { "binary": "cursor", "available": true },
    "claude": { "binary": "claude", "available": true }
  }
}
```

---

## 🔌 The Plugin System

A **Plugin** bundles skills, commands, hooks, and tools into a single installable package.

### Plugin Structure

```
my-plugin/
├── .agent-plugin/
│   └── plugin.json          # Manifest
├── skills/
│   └── security-scan/
│       ├── skill.json
│       └── prompt.md
├── commands/
│   └── audit.md
└── hooks/
    └── hooks.json
```

### Manifest (`plugin.json`)

```json
{
  "name": "enterprise-security",
  "version": "1.0.0",
  "description": "Security scanning and compliance",
  "skills": ["skills/"],
  "commands": ["commands/"],
  "hooks": "hooks/hooks.json"
}
```

### CLI

```bash
agent plugins install ./my-plugin    # Install from local path
agent plugins list                   # Show installed plugins
agent plugins remove my-plugin      # Uninstall
```

When a plugin is installed, its skills, commands, and hooks are automatically loaded on every `agent` run.

---

## 🚀 What's Next?

The plugin ecosystem opens the door to community contributions. Imagine installing `agent plugins install security-scanner` and instantly getting OWASP scanning as a hook on every build.

In **Part 7**, we'll cover the new **Interactive CLI**—the Claude Code-style conversational experience.
