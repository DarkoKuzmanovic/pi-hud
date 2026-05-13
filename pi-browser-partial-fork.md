# pi-browser-partial-fork

## Goal

Install `@dreki-gg/pi-browser-tools` but **strip the colliding `web_search` tool** to avoid overriding the existing `@counterposition/pi-web-search` (Brave/Tavily/Exa/Jina).

## Current collision

| Tool            | Existing (pi-web-search)                            | pi-browser-tools                                    |
| --------------- | --------------------------------------------------- | --------------------------------------------------- |
| `web_search` ❌ | Multi-provider with `depth`, `freshness`, `domains` | DuckDuckGo with `allowed_domains`/`blocked_domains` |

## What to keep (non-colliding)

- `web_visit` — URL → markdown with optional browser rendering
- `web_screenshot` — page screenshots (desktop/mobile viewport)
- `web_interact` — click, type, scroll, hover on open browser
- `web_console` — read console logs/warnings/errors
- `/browser` command — show browser status

## What to remove

Remove the `web_search` tool registration entirely:

- Delete lines 64–94 in `extensions/browser-tools/index.ts` (the `pi.registerTool({ name: 'web_search', ... })` block)
- Remove the `import { webSearch } from './search.js'` line if nothing else uses it
- Remove or re-export `formatSearchResults` if it's only used by `web_search`

## Plan

1. Fork `dreki-gg/pi-extensions` repo
2. Create `pi-browser-partial` package or just modify `pi-browser-tools` in-place
3. Strip `web_search` registration from `extensions/browser-tools/index.ts`
4. Publish or symlink locally
5. Install in Pi via `pi install` or manual symlink
