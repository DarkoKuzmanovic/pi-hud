# Task: Fork pi-browser-tools and Strip web_search

You are implementing a partial fork of `@dreki-gg/pi-browser-tools` to get browser automation tools without the `web_search` tool that collides with our existing superior search provider.

## Background

Pi is a coding agent with an extension system. Extensions register tools via `pi.registerTool()`. When two extensions register tools with the same name, the last one loaded wins — there is no merge or disambiguation.

We already have `@counterposition/pi-web-search` installed (multi-provider: Brave/Tavily/Exa/Jina). The `@dreki-gg/pi-browser-tools` package registers `web_search` (DuckDuckGo only) alongside browser tools we want (`web_visit`, `web_screenshot`, `web_interact`, `web_console`). We need the browser tools without the search collision.

## Key Paths

- **Pi settings**: `~/.pi/agent/settings.json` (contains `packages` array)
- **Existing web search**: installed as `"npm:@counterposition/pi-web-search"` in settings.json
- **Source repo**: `https://github.com/dreki-gg/pi-extensions`
- **npm package name**: `@dreki-gg/pi-browser-tools` (v0.1.2)
- **Extension entry**: `extensions/browser-tools` directory (single `index.ts` entry point)

## Execution Steps

### Step 1: Fork the repo on GitHub

[DONE:1]

Fork `dreki-gg/pi-extensions` to `DarkoKuzmanovic/pi-browser-tools` on GitHub. If the repo name `pi-browser-tools` is taken, use `pi-extensions` or any descriptive name.

### Step 2: Clone the fork

[DONE:2]

```bash
cd ~/.pi/agent/git/github.com/DarkoKuzmanovic
git clone https://github.com/DarkoKuzmanovic/pi-browser-tools.git
cd pi-browser-tools
```

### Step 3: Examine the extension entry point

[DONE:3]

Read `extensions/browser-tools/index.ts` (or `extensions/browser-tools/index.js` if compiled). Map out:

- All `pi.registerTool()` calls — identify which block is `web_search`
- All imports — identify which are only used by `web_search`
- The `/browser` command registration

**CRITICAL**: The repo may be a monorepo with other extensions (like `pi-plan-mode`). Check `package.json` at root to understand the structure. We only care about the `extensions/browser-tools/` subtree.

### Step 4: Remove web_search registration

[DONE:4]

In `extensions/browser-tools/index.ts`:

1. **Delete the entire `pi.registerTool({ name: 'web_search', ... })` block** — the original plan doc estimates this at lines 64–94, but verify after reading the actual file

2. **Remove dead imports** — if `webSearch` (or similar) is imported from `./search.js` and only used in the deleted block, remove that import

3. **Remove dead helper imports** — if `formatSearchResults` or similar formatting helpers are imported and only used by the deleted `web_search` block, remove those imports too

4. **Do NOT touch**:
   - `web_visit` tool registration
   - `web_screenshot` tool registration
   - `web_interact` tool registration
   - `web_console` tool registration
   - `/browser` command registration
   - Any shared utilities used by the tools we're keeping

### Step 5: Verify no dangling references

[DONE:5]

```bash
cd ~/.pi/agent/git/github.com/DarkoKuzmanovic/pi-browser-tools
grep -rn "webSearch\|web_search\|formatSearchResults" extensions/browser-tools/
```

The only acceptable matches are:

- Comments explaining the removal
- References inside `search.ts`/`search.js` files (which are now unused but harmless)

If any tool registration or active code still references `web_search` or its helpers, fix the dangling reference.

### Step 6: Check for monorepo / plan-mode collision

[DONE:6]

```bash
ls extensions/
cat package.json | grep -A5 '"pi"'
```

If the repo contains other extensions (like `plan-mode`):

- We MUST use package filtering in settings.json to load ONLY `extensions/browser-tools`
- `@dreki-gg/pi-plan-mode` is already installed separately as an npm package — do NOT load it again from this fork

### Step 7: Install dependencies

[DONE:7]

```bash
cd ~/.pi/agent/git/github.com/DarkoKuzmanovic/pi-browser-tools
npm install
```

If playwright needs browser binaries:

```bash
npx playwright install chromium
```

### Step 8: Add to settings.json

[DONE:8]

Edit `~/.pi/agent/settings.json`. Add to the `packages` array:

```json
{
  "source": "https://github.com/DarkoKuzmanovic/pi-browser-tools",
  "extensions": ["extensions/browser-tools"]
}
```

**Important**: The `"extensions"` filter ensures we only load browser-tools, not any other extensions in the repo. This is critical if the repo is a monorepo.

Place this entry BEFORE the `"npm:@counterposition/pi-web-search"` entry in the array, OR after it — what matters is that `pi-web-search` loads its `web_search` tool and our fork does NOT register a competing one (because we removed it). Order doesn't matter since the collision is eliminated.

### Step 9: Commit the changes to the fork

[DONE:9]

```bash
cd ~/.pi/agent/git/github.com/DarkoKuzmanovic/pi-browser-tools
git add -A
git commit -m "Remove web_search tool to avoid collision with pi-web-search"
git push origin main
```

### Step 10: Test

[DONE:10]

After restarting Pi, verify:

1. Run a web search to confirm it uses the existing provider (look for Brave/Tavily/Exa in output)
2. Check that `web_visit`, `web_screenshot`, `web_interact`, `web_console` appear in available tools
3. Check `/browser` command works

## Constraints

- **Do NOT modify any files outside the fork directory and `~/.pi/agent/settings.json`**
- **Do NOT remove or modify the existing `@counterposition/pi-web-search` package**
- **The fork MUST NOT register a `web_search` tool** — this is the entire point
- **Keep all non-search browser tools intact** — `web_visit`, `web_screenshot`, `web_interact`, `web_console`
- **Keep the `/browser` command intact**
- **If the repo is a monorepo, use extension filtering** to avoid double-loading other extensions like plan-mode
