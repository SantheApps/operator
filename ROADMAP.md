# 🛣️ Roadmap: The Future of @praveencs/agent

We have built a robust autonomous agent runtime (`v0.7.x`). But this is just the beginning.
Here is our vision for the next major milestones.

## Phase 1: Robustness & Safety (Current Focus)
- [ ] **Sandboxed Execution**: Run all shell skills inside ephemeral Docker containers to prevent accidental system damage.
- [ ] **Permission Scopes**: Fine-grained access control (e.g., "Allow read access to `/project` but write access only to `/project/src`").
- [ ] **Secrets Management**: Secure, encrypted storage for API keys integrated with system keychains.

## Phase 2: Multi-Agent Collaboration (The Swarm)
- [ ] **Agent-to-Agent Protocol**: Define a standard schema for agents to send messages and delegate tasks to each other.
- [ ] **Specialized Personas**:
    - `Coder Agent`: Writes and tests code.
    - `Reviewer Agent`: Critiques pull requests.
    - `Architect Agent`: High-level system design.
- [ ] **Orchestrator**: A master process that spins up specialized agents for a complex goal.

## Phase 3: Multimodal Interfaces
- [ ] **Voice Interface**: Speak to your agent ("Deploy this to prod") and hear responses.
- [ ] **Vision Capabilities**: Allow the agent to "see" your screen or read images (e.g., "Fix the CSS on this screenshot").
- [ ] **IDE Integration**: VS Code extension to have the agent live in your editor sidebar.

## Phase 4: The Agent Cloud
- [ ] **Skill Hub**: A public registry (npm-style) to share and install community skills.
- [ ] **Remote Execution**: Run the heavy agent logic on a cloud server while controlling it from your laptop.
- [ ] **Web Dashboard**: Real-time visualization of agent thought processes, memory graph, and task plans.

## Phase 5: Plugin Ecosystem & Extensibility ✅
- [x] **Lifecycle Hooks**: Event-driven hook system (`before:tool`, `after:step`, `before:plan`, etc.) allowing custom scripts to intercept and validate agent execution at every stage.
- [x] **Lightweight Commands**: Reusable goal templates defined as markdown files with YAML frontmatter — no `skill.json` boilerplate needed. Auto-detected by `agent run <command-name>`.
- [x] **Multi-CLI Orchestration**: First-class tool wrappers for external AI CLIs (`cli.cursor`, `cli.codex`, `cli.gemini`, `cli.claude`) so the agent can delegate specialized coding sub-tasks to the right tool.
- [x] **Plugin System**: Distributable bundles (`plugin.json`) that package skills, commands, hooks, and tools together. Install with `agent plugins install <path>`.
- [x] **New CLI Commands**: `agent hooks list|add|events`, `agent commands list`, `agent plugins list|install|remove`.

## Phase 6: Interactive CLI Experience ✅
- [x] **Interactive REPL**: When the user types `agent` with no arguments, launch a conversational session with multi-turn context, slash commands, and inline tool execution.
- [x] **Slash Commands**: Built-in `/help`, `/skills`, `/commands`, `/hooks`, `/model`, `/compact`, `/clear`, `/exit` — plus any user-defined commands are auto-registered as `/command-name`.
- [x] **Rich Terminal UI**: Bordered welcome banner, ora spinners during LLM thinking, inline tool call badges (⚡ running → ✓/✗), completion summaries with timing.
- [x] **Tab Completion**: Autocomplete slash commands and user commands in the REPL.
- [x] **Conversation Context**: Multi-turn session with conversation compaction support.

## 🤝 Join the Mission
This is an open-source journey. We need help with:
- Writing new Skills (see `docs/articles/03-skill-execution.md`)
- Improving the Planner prompt engineering
- Building the Web Dashboard

Submit a PR and let's build the future of work, together.
