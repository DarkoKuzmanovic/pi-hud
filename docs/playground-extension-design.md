# Pi Playground Extension — Design Spec

> Inspired by Google Antigravity's Playground feature — a separate workspace where you can experiment without affecting your project files.

## Problem

When working in Pi on a project, the agent naturally reads and operates on project files. But sometimes you want to:

- **Prototype/experiment** without the agent reading project context or accidentally modifying project files
- **Reason about a problem** in a clean slate, free from project-specific assumptions
- **Test something quickly** (a script, a snippet, an API call) without polluting the project
- **Work on a side task** that's unrelated to the current project

Currently, the only way to do this is to start a new Pi session in a different directory — losing your conversation context.

## Concept

A **Playground Mode** toggle in Pi that:

1. Switches all file-ops tools to operate in an isolated sandbox directory (`/tmp/pi-playground-$USER/`)
2. Blocks access to the original project directory
3. Injects a system prompt instruction so the LLM knows it's in playground mode
4. Shows a clear visual indicator (footer status) so you always know which mode you're in
5. Optionally, persists playground work back into the project when you're done

This is a workspace-level isolation, not OS-level sandboxing (which is a separate concern — see the existing `sandbox/` extension example for kernel-level isolation).

## Google Antigravity Reference

Antigravity separates **Playground** from **Workspaces**:

| Feature     | Playground                     | Workspace              |
| ----------- | ------------------------------ | ---------------------- |
| Setup       | Instant, no config             | Requires project setup |
| File access | Isolated temp dir              | Full project tree      |
| Persist     | "Move to workspace" action     | Native                 |
| Use case    | Experiment, explore, prototype | Project work           |

Key Antigravity feature we want to mirror: **"Move to workspace"** — when playground work is worth keeping, copy it into the project at a chosen path.

Antigravity also has **Terminal Sandboxing** (kernel-level via `sandbox-exec`/`nsjail`), which restricts file writes to designated dirs. This is a complementary feature — the playground extension could optionally integrate with the `sandbox/` extension for defense-in-depth.

## Recommended Implementation: Hybrid (Tool Override + Selective Blocking)

### Approach A: Tool Override (Primary)

Override each built-in file-op tool with a version scoped to the playground directory. Pi already provides factory functions for this:

```typescript
import {
  createBashTool,
  createReadTool,
  createWriteTool,
  createEditTool,
  createFindTool,
  createGrepTool,
  createLsTool,
} from "@earendil-works/pi-coding-agent";

const playgroundCwd = `/tmp/pi-playground-${process.env.USER}`;
const tools = {
  read: createReadTool(playgroundCwd),
  bash: createBashTool(playgroundCwd),
  // ... etc
};
```

This is the pattern used in `minimal-mode.ts` and `sandbox/index.ts` examples. Robust, well-tested.

### Approach B: Selective Blocking (Safety Net)

Add a `tool_call` interception layer that blocks any tool call with a path outside the playground:

```typescript
pi.on("tool_call", async (event, ctx) => {
  if (!playgroundActive) return;
  const path = event.input.path || event.input.command;
  // Block if path resolves outside playgroundCwd
  if (isOutsidePlayground(path)) {
    return {
      block: true,
      reason: "Playground mode: access restricted to playground directory",
    };
  }
});
```

This catches edge cases the tool override might miss (custom tools, MCP tools).

### System Prompt Injection

```typescript
pi.on("before_agent_start", async (event) => {
  if (playgroundActive) {
    return {
      systemPrompt:
        event.systemPrompt +
        "\n\n## PLAYGROUND MODE\nYou are in PLAYGROUND MODE. All file operations are scoped to /tmp/pi-playground-USER. The project directory is NOT accessible. Experiment freely — nothing here affects the real project. Use /playground to return to project mode.",
    };
  }
});
```

## Commands

| Command                   | Action                                            |
| ------------------------- | ------------------------------------------------- |
| `/playground`             | Toggle playground mode on/off (with confirmation) |
| `/playground on`          | Activate playground mode                          |
| `/playground off`         | Return to project mode                            |
| `/playground save [dest]` | Copy playground files into project at `dest` path |
| `/playground status`      | Show current mode and playground directory path   |

## Visual Indicator

Footer status badge using `ctx.ui.setStatus()`:

- **Project mode**: No badge (or `📁 project`)
- **Playground mode**: `🧪 Playground` (accent colored)

## State Management

- `pi.appendEntry("playground-state", { active: true, dir: playgroundCwd })` — persists across session resumes
- On `session_start`, check for saved state and restore
- On toggle, save original tool set so we can restore cleanly

## Playground Directory

Default: `/tmp/pi-playground-$USER/`

- Created on first activation if it doesn't exist
- Persists across Pi sessions (not ephemeral `/tmp` cleanup — user explicitly manages it)
- Can be configured via `.pi/playground.json` or `~/.pi/agent/playground.json`:

```json
{
  "directory": "/tmp/pi-playground-quzma",
  "autoClean": false,
  "blockProjectAccess": true
}
```

## Persist-to-Project Feature

`/playground save src/experiments/my-test` copies the playground dir contents into the project at the specified path:

```typescript
pi.registerCommand("playground", {
  handler: async (args, ctx) => {
    if (args?.startsWith("save ")) {
      const dest = args.slice(5).trim();
      const projectCwd = originalCwd; // saved at toggle time
      await copyDir(playgroundCwd, join(projectCwd, dest));
      ctx.ui.notify(`Playground saved to ${dest}`, "success");
    }
  },
});
```

## Relationship to Existing Extensions

| Extension            | Overlap                   | Difference                                                                                         |
| -------------------- | ------------------------- | -------------------------------------------------------------------------------------------------- |
| `sandbox/`           | Both restrict file access | Sandbox = kernel-level isolation for bash; Playground = workspace-level cwd redirect for ALL tools |
| `protected-paths.ts` | Both block writes         | Protected paths = block specific dirs; Playground = allow only playground dir                      |
| `preset.ts`          | Both toggle modes         | Presets = model/tools/prompt config; Playground = workspace isolation                              |

**Integration opportunity**: Playground mode could optionally enable the `sandbox/` extension's kernel-level restrictions for defense-in-depth.

## Implementation Checklist

- [ ] Create `~/.pi/agent/extensions/playground/index.ts`
- [ ] Implement tool override (Approach A) for read/write/edit/bash/find/grep/ls
- [ ] Implement tool_call blocking (Approach B) as safety net
- [ ] Implement system prompt injection via `before_agent_start`
- [ ] Implement `/playground` command with toggle
- [ ] Implement `/playground save` for persist-to-project
- [ ] Implement status indicator
- [ ] Implement state persistence via `pi.appendEntry()`
- [ ] Add config file support (`.pi/playground.json`)
- [ ] Test: toggle on/off preserves conversation context
- [ ] Test: file ops in playground mode don't touch project
- [ ] Test: save copies files correctly
- [ ] Test: session resume restores playground state

## Future Ideas

- **Multiple playgrounds**: Named playground dirs per topic (e.g., `/playground create api-testing`)
- **Playground templates**: Pre-populate playground with common files (package.json, tsconfig, etc.)
- **Playground list**: `ls /tmp/pi-playground-*` to see all playgrounds
- **Docker integration**: Run playground commands in a container for true OS-level isolation
- **Auto-cleanup**: Option to purge playground dirs older than N days
