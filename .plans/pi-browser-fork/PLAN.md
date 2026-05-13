# Fork pi-browser-tools Without web_search

Install `@dreki-gg/pi-browser-tools` browser automation tools (web_visit, web_screenshot, web_interact, web_console) while removing the colliding `web_search` tool that would override our existing `@counterposition/pi-web-search` (Brave/Tavily/Exa/Jina multi-provider search).

## Context

- **Existing `web_search`**: `@counterposition/pi-web-search` — registered in `extensions/web-search.ts`, supports Brave/Tavily/Exa/Jina with `depth`, `freshness`, `domains` params. Also provides `web_fetch`. Already installed as `"npm:@counterposition/pi-web-search"` in settings.json.
- **Colliding `web_search`**: `@dreki-gg/pi-browser-tools` — DuckDuckGo-only search with `allowed_domains`/`blocked_domains`. Inferior to what we have.
- **Source repo**: `github.com/dreki-gg/pi-extensions` (from npm `repository.url`)
- **Package entry point**: `pi.extensions = ['./extensions/browser-tools']` — single extension directory, all tools registered in one `index.ts` file
- **Pi tool collision behavior**: Last-loaded extension wins when two tools share a name. No way to selectively disable a single tool from a package via Pi's filtering (filtering is file-level, not tool-level).
- **Non-colliding tools to keep**: `web_visit`, `web_screenshot`, `web_interact`, `web_console`, `/browser` command
- **Dependencies**: `playwright`, `@mozilla/readability`, `linkedom`, `turndown`
- **Settings path**: `~/.pi/agent/settings.json` — packages array

## Plan:

1. **Fork the repo on GitHub** — Fork `dreki-gg/pi-extensions` to `DarkoKuzmanovic/pi-browser-tools` (or keep as `DarkoKuzmanovic/pi-extensions`)

2. **Clone the fork locally** — It will land at `~/.pi/agent/git/github.com/DarkoKuzmanovic/pi-browser-tools/`

3. **Strip `web_search` tool registration** — In `extensions/browser-tools/index.ts`:
   - Remove the entire `pi.registerTool({ name: 'web_search', ... })` block (plan doc says lines 64–94, verify after clone)
   - Remove the `import { webSearch } from './search.js'` line if nothing else uses it
   - Remove `formatSearchResults` import if only used by `web_search`
   - Keep all other tool registrations (`web_visit`, `web_screenshot`, `web_interact`, `web_console`) and the `/browser` command

4. **Verify no remaining references** — grep for `webSearch`, `web_search`, `formatSearchResults` across the browser-tools extension to ensure no dangling references

5. **Run `npm install`** in the cloned fork to install dependencies (playwright, readability, linkedom, turndown)

6. **Add to settings.json** — Add the fork as a git package:

   ```json
   {
     "source": "https://github.com/DarkoKuzmanovic/pi-browser-tools",
     "extensions": ["extensions/browser-tools"]
   }
   ```

   Place it in the `packages` array in `~/.pi/agent/settings.json`

7. **Test** — Restart Pi and verify:
   - `web_search` still uses the Brave/Tavily/Exa provider (from `@counterposition/pi-web-search`)
   - `web_visit`, `web_screenshot`, `web_interact`, `web_console` are available
   - `/browser` command works

## Risks / Open Questions

- **Repo structure uncertainty**: We haven't seen the actual source of `extensions/browser-tools/index.ts`. The line numbers from the plan doc (64–94) may have shifted across versions. The implementor must verify exact line ranges after cloning.
- **Monorepo or single-package?**: `dreki-gg/pi-extensions` may contain multiple packages (plan-mode, browser-tools, etc.). If it's a monorepo, we may need to scope the fork's `pi.extensions` to just `['./extensions/browser-tools']` to avoid loading plan-mode twice (it's already installed as `npm:@dreki-gg/pi-plan-mode`).
- **Playwright install**: `playwright` may need browser binaries (`npx playwright install chromium`). Check if the extension handles this or if manual setup is needed.
- **Future updates**: The fork diverges from upstream. Consider setting up a GitHub Action or periodic manual sync, rebasing the `web_search` removal on top of upstream changes.
- **Alternative approach**: Instead of forking, we could install the package normally and add a small extension that calls `pi.setActiveTools()` to remove `web_search` from browser-tools after load. This avoids fork maintenance but is fragile (depends on load order). The fork approach is more reliable.
