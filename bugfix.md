# pi-hud Bugfix Plan

**Date:** 2026-07-24
**Panel:** 4 independent reviewers (gpt-5.6-sol, grok-4.5, claude-opus-5, kimi-coding/k3), all at thinking:high
**Baseline:** `tsc --noEmit` clean, 59/59 tests pass
**Method:** Each reviewer audited a distinct axis (architecture, robustness, security, rendering). All findings below were independently fact-checked against source by the orchestrator. Line references verified at time of writing.

---

## Resolution Status

_Local planning doc — intentionally untracked, not shipped._

**Resolved:** 2026-07-24 · committed as `e5eaae5` (fix) on top of `b24edac` (Grok/Kimi/snapshot feature) · pushed to `origin/main`.
**Gate:** `tsc --noEmit` clean · 59/59 tests · `biome check` clean. The staged feature was independently verified green (patch-strip) before being committed on its own.

| Item | Status | Notes |
|------|--------|-------|
| 0.1 marker overflow | ✅ FIXED | Capped to 2 digits. Used `↑99`, not the plan's `↑99+` — `+` is a 4th column and would re-break the 3-wide marker (reviewer confirmed). |
| 0.2 reader.cancel | ✅ FIXED | `void reader.cancel().catch(() => {})`. |
| 1.1 writeAuth lock bypass | ✅ FIXED | Preferred fix: removed `writeAuth` + `persistCodexAuth`; pi-hud is read-only for auth.json (Pi owns refresh). |
| 1.2 Codex refresh timeout | ✅ FIXED | `AbortSignal.timeout(15_000)`. |
| 1.3 refreshed token discarded | ⊘ MOOT | Superseded by 1.1 — no persist path left to fail. |
| 1.4 writeAuth mode 0600 | ⊘ MOOT | Superseded by 1.1 — writeAuth removed. |
| 2.1 render before refresh | ✅ FIXED | `trackRefresh(….then(() => requestRenderAll()))` on install/model_select/openference; model_select keeps its immediate render too. |
| 2.2 session_tree handler | ✅ FIXED | New handler rebuilds totals (`initSessionTotals` + branch walk, same as session_start). |
| 3.1 missing .catch | ✅ FIXED | `.catch` on all fire-and-forget refresh paths. |
| 3.2 anthropic resetAt NaN | ✅ FIXED | `parseResetAt` finite guard. |
| 3.3 grok weekly 0% | ✅ FIXED | Finite-only. |
| 3.4 git ahead/behind NaN | ✅ FIXED | `Number.isFinite` guard; `hasRemote: false` fallback. |
| 3.5 stale loading msg | ✅ FIXED | Message cleared when mapped status is `ok`. |
| 3.6 loose validators | ✅ FIXED | Codex requires a window; kimi/umans require ≥1 finite recognized field (tightened in the post-review fix-pass). |
| 3.7 body not drained | ✅ FIXED | `await response.body?.cancel().catch(() => {})` before each early throw. |
| 3.8 curl redirect | ✅ FIXED | Removed `location` from curl config. |
| 3.9 usedPercent NaN | ✅ FIXED | `Number.isFinite(w.usedPercent)`. |
| 4.1 border scroll cues | ✅ FIXED | Extract `↑N`/`↓N` into `fitBorder`. |
| 4.2 shutdown in-flight | ◐ PARTIAL | Rejection-safe tracking (`inFlightRefreshes` Set + `trackRefresh` on all paths incl. timer) + honest comments. No true abort/await — the host runs `session_shutdown` synchronously and never awaits it, so a drain would be theatrical. Non-blocking residual (read-only creds, per-provider dedup, totals resync on start). |
| 4.3 openference sync I/O | ✅ FIXED | `fs/promises` + `promisify(execFile)`. |
| 4.4 narrow-width guards | ✅ FIXED | `width < 4 → super.render(width)` in marker + boxed. |
| 4.5 marker early-return padding | ✅ FIXED | `withEditorPadding` applied on the early return. |
| 5.1 AGENTS.md cookies.ts | ✅ FIXED | Removed cookies.ts refs + synced provider list (local-only — AGENTS.md is gitignored). |
| 5.2 any / ! conventions | ✅ FIXED | `any→unknown` + `isAuthEntry` guard; removed `!` (anthropic/kimi); index catch `unknown`. Residual: `render/context.ts:26` `accumulateMessage(msg: any)` — pre-existing, outside this plan's file list. |
| 5.3 JSONC regex | ✅ FIXED | `replaceJsoncKey` line-anchored (skips commented keys); post-review fix-pass removed a dead `//` branch. |
| 5.4 test coverage | ⬜ UNFIXED | No new regression tests (marker cap, session_tree rebuild, shutdown-during-refresh, fetchWithAuth drain, rejected promises). Suite green, but blockers are not locked by tests. (writeAuth/persist tests now moot — those were removed.) |
| 5.5 /hud status Openference | ✅ FIXED | Added. |
| 5.6 package-lock gitignored | ⬜ UNFIXED | `.gitignore:6` still ignores it. Low risk (no runtime deps). |

### Still open

- **4.2 — true shutdown drain/abort.** Tracking + honest comments landed; actual cancellation (AbortController threaded into `fetchWithAuth`, or a generation token) was deliberately not built — the host does not await the synchronous `session_shutdown` handler, so it cannot drain. Revisit only if Pi makes shutdown awaitable.
- **5.4 — regression tests** for the Phase 0/2 fixes. Highest-value follow-up: a marker-skin test asserting the render stays at `width` columns for scroll offsets ≥ 100.
- **5.6 — package-lock.json** un-gitignore (optional; no runtime deps today).
- **Reviewer residual — `render/context.ts:26`** still `msg: any` (pre-existing convention debt, outside this plan).
- **Operational note — Codex OAuth thrash:** accepted 1.1 tradeoff. An expired on-disk token triggers a refresh on every quota poll (not persisted). Safe for auth.json; can hammer the token endpoint until Pi itself refreshes.

## Verified Correct (do not re-litigate)

- In-flight dedup pattern across all 7 providers with `.finally()` cleanup
- Timer lifecycle: cleared before re-registration, on dispose, on shutdown
- No command injection (all `execFile`/`execFileSync` with argv arrays, no shell)
- No SQL injection (openference.ts uses fixed string literal)
- No path traversal (readdirSync of fixed root, constant suffix join)
- Tokens never in process argv (curl config piped via stdin)
- Temp-file handling sound (mkdtempSync 0700, rmSync in unconditional finally)
- No credential logging (zero console/stdout across all .ts)
- pi-tui-shim re-export correct (root index.d.ts verified)
- Footer/header overflow-safe (padBetween → truncateToWidth cap)
- Anthropic 429 backoff with Retry-After + 5min floor
- Git helpers never reject to callers (resolve to safe defaults)
- TokenSpeedTracker bounded (5000-entry compaction, fires on message_update)

---

## Phase 0 — TUI Crash / Process Death

### 0.1 Marker skin scroll indicator overflow → TUI crash

**Severity:** Blocker
**File:** `render/editors/marker.ts:17, 66-72, 77-81, 95-100`
**Found by:** k3

`markerWidth` is fixed at 3. `makeMarker()` computes `pad = " ".repeat(Math.max(0, markerWidth - styledVisible))`. When the parent editor reports `↑ 120 more`, the indicator `↑120` is 4 columns → pad clamps to 0 → marker renders 4 cols. Total line = 4 + innerWidth = width + 1. Per project history, any line exceeding width crashes the TUI. Reachable via large multi-line pastes (100+ wrapped lines).

**Fix:** Cap the indicator to 2 digits inside `makeMarker`:
```ts
const makeMarker = (indicator?: string): string => {
    let glyph = indicator ?? markerRaw;
    if (indicator) {
        const num = indicator.slice(1); // strip ↑/↓
        glyph = num.length > 2 ? `${indicator[0]}99+` : indicator;
    }
    const styled = this.borderColor(glyph);
    const styledVisible = indicator ? Math.min(glyph.length, markerWidth) : 1;
    const pad = " ".repeat(Math.max(0, markerWidth - styledVisible));
    return `${styled}${pad}`;
};
```
Alternatively, compute `markerWidth = Math.max(3, indicatorWidth)` per render and subtract from innerWidth before calling `super.render`. The cap approach is simpler and preserves layout stability.

**Acceptance:** Marker skin renders at exactly `width` columns for scroll offsets 0, 1, 9, 10, 99, 100, 999, 9999.

---

### 0.2 `reader.cancel()` unhandled rejection → process exit

**Severity:** Blocker
**File:** `providers/shared.ts:198`
**Found by:** opus

```ts
reader.cancel();          // floating promise, no .catch()
throw new FetchError("large", "large response");
```

`ReadableStreamDefaultReader.cancel()` returns a promise that can reject. Node 24 default `--unhandled-rejections=throw` exits the process with code 1. A rejected `cancel()` here kills the entire Pi agent, not just the HUD.

**Fix:**
```ts
void reader.cancel().catch(() => {});
```

**Acceptance:** Oversized response (>128 KiB) from any provider does not crash the process even if the underlying stream errors during cancellation.

---

## Phase 1 — Credential Integrity

### 1.1 `writeAuth` bypasses Pi's credential-store lock → corruption / lost update

**Severity:** Blocker
**File:** `providers/shared.ts:23-25`, caller `providers/codex.ts:155-166`
**Found by:** opus (primary), grok (independently)

Pi's `FileAuthStorageBackend` wraps every read-modify-write of `auth.json` in `proper-lockfile.lockSync()` with 10×20ms retry, writes with `mode: 0o600` + explicit `chmodSync`. pi-hud's `writeAuth` does bare `writeFileSync` — no lock, no temp+rename, no mode.

Two concrete failure modes:
- **Lost update:** `persistCodexAuth` does readAuth → mutate → writeAuth. If Pi refreshes another provider's token in that window, pi-hud writes back its stale whole-file snapshot, silently reverting the other provider's credentials.
- **Torn read:** `writeFileSync` truncates then writes. Pi's locked reader can observe a partial file → JSON.parse failure → all credentials appear absent.

**Fix (preferred):** Don't persist refreshed tokens at all. pi-hud only needs read access for display. Remove `persistCodexAuth` and `writeAuth`; let Pi own the refresh cycle. The refreshed token is already used in-memory for the immediate retry fetch (codex.ts:203).

**Fix (alternative):** If persistence is desired, take the same lock Pi uses:
```ts
import lockfile from "proper-lockfile";
export function writeAuth(auth: Record<string, unknown>): void {
    const release = lockfile.lockSync(AUTH_PATH, { retries: { retries: 10, minTimeout: 20 } });
    try {
        const tmp = `${AUTH_PATH}.${process.pid}.tmp`;
        writeFileSync(tmp, `${JSON.stringify(auth, null, 2)}\n`, { mode: 0o600 });
        renameSync(tmp, AUTH_PATH);
    } finally {
        release();
    }
}
```

**Acceptance:** Concurrent Pi token refresh + pi-hud quota refresh does not corrupt or revert auth.json.

---

### 1.2 Codex token refresh has no timeout → pins in-flight slot forever

**Severity:** High
**File:** `providers/codex.ts:129-152`
**Found by:** grok

`refreshCodexAuth` uses bare `fetch()` with no AbortSignal. The usage path uses `fetchWithAuth` (15s timeout), but the refresh path does not. A hung OAuth token POST leaves `codexInFlight` set indefinitely; all later refreshes await the same hung promise.

**Fix:** Add `signal: AbortSignal.timeout(15_000)` to the fetch options, or reuse `fetchWithAuth`.

**Acceptance:** A hung OAuth endpoint releases the in-flight slot within 15s.

---

### 1.3 Refreshed Codex token discarded if disk write fails

**Severity:** Medium
**File:** `providers/codex.ts:199-203`
**Found by:** grok

`persistCodexAuth(refreshed)` at line 201 is outside the inner try/catch. If `writeAuth` throws (disk full, permissions), the error propagates to the outer catch at 189 → returns `"network"` → the retry with `refreshed.access` at line 203 never executes. The valid refreshed token is lost.

**Fix:** Wrap persist in its own try/catch; always attempt the retry fetch regardless of persist outcome:
```ts
const refreshed = await refreshCodexAuth(cred.refresh);
if (!refreshed) return { usage: null, status: "auth-needed", message: err.message };
try { persistCodexAuth(refreshed); } catch { /* best-effort persist */ }
try {
    return await fetchCodexUsageWithAccess(refreshed.access, cred.accountId);
} catch (retryErr) { ... }
```

**Acceptance:** Disk write failure during persist does not prevent the usage fetch from succeeding with the refreshed token.

---

### 1.4 `writeAuth` omits `mode: 0o600` — latent world-readable credentials

**Severity:** Medium (latent — existing file preserves mode; new file would be 0644)
**File:** `providers/shared.ts:24`
**Found by:** opus

**Fix:** Add `{ mode: 0o600 }` to writeFileSync options. (Moot if 1.1 preferred fix removes writeAuth entirely.)

---

## Phase 2 — Functional Correctness

### 2.1 Startup/model_select refresh renders before async completion

**Severity:** High
**File:** `index.ts:444, 614-618`
**Found by:** gpt-5.6-sol

`install()` fires `void refreshActiveProvider(ctx)` (line 444) with no completion callback. `model_select` fires `void refreshActiveProvider(ctx)` (line 616) then immediately calls `requestRenderAll()` (line 617) — the render executes before the async refresh resolves, displaying stale or "loading" state. The timer path (line 471-477) correctly chains `.then(() => requestRenderAll())`.

Once the fire-and-forget refresh completes and stamps `updatedAt`, the timer considers the data fresh and skips re-refresh. The footer remains on "loading" or the previous provider's quota until an unrelated event triggers a render.

**Fix:** Chain a render on completion, matching the timer pattern:
```ts
// install():
void refreshActiveProvider(ctx).then(() => requestRenderAll());

// model_select:
void refreshActiveProvider(ctx).then(() => requestRenderAll());
// Remove the premature synchronous requestRenderAll() at line 617,
// or keep it for immediate visual feedback + add the .then() for post-refresh.
```

**Acceptance:** Switching providers via model_select shows the new provider's quota within 1-2s (network latency), not "loading" until the next unrelated render.

---

### 2.2 No `session_tree` handler → stale totals after /tree navigation

**Severity:** High
**File:** `index.ts` (missing handler)
**Found by:** gpt-5.6-sol

Totals are rebuilt only on `session_start` (index.ts:556-578) and incremented from `message_end` (index.ts:660-663). There is no `session_tree` handler. After `/tree` branch navigation, totals continue representing the abandoned branch; new messages are added to stale totals. Pi's shipped state-management example reconstructs on both `session_start` and `session_tree`.

**Fix:** Add a `session_tree` handler that re-runs the same total-reconstruction logic used in `session_start`:
```ts
pi.on("session_tree", (_event, ctx) => {
    // Rebuild totals from the new branch
    totals = { inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
    for (const msg of ctx.sessionManager.getBranch()) {
        if (msg.role === "assistant") accumulateMessage(msg);
    }
    requestRenderAll();
});
```

**Acceptance:** After `/tree` navigation, footer session totals reflect the new branch's history.

---

## Phase 3 — Data Integrity / Robustness

### 3.1 Fire-and-forget refresh promises lack `.catch()`

**Severity:** Medium
**File:** `index.ts:444, 471, 616, 631`
**Found by:** gpt-5.6-sol, grok

All `void refresh...()` calls omit `.catch()`. Any uncaught throw becomes an unhandled rejection (process hazard on Node 24). The `.then()` success path is also skipped, leaving the footer stale with no error status.

**Fix:** Add `.catch(() => {})` at minimum, or better: set provider status to error in the catch:
```ts
void refreshActiveProvider(ctx)
    .then(() => requestRenderAll())
    .catch(() => requestRenderAll()); // render with whatever error state the provider set
```

---

### 3.2 Anthropic `resetAt` can be NaN

**Severity:** Medium
**File:** `providers/anthropic.ts:148-149`
**Found by:** grok

`Date.parse(resets_at)` with no `Number.isFinite` check. Invalid string → `resetAt: NaN` → `fmtDuration` shows `"now"` (misleading). Note: `usage-snapshot.ts:107` correctly guards with `Number.isFinite(t)` — the direct anthropic path does not.

**Fix:**
```ts
const parsed = Date.parse(result.usage.five_hour.resets_at);
resetAt: Number.isFinite(parsed) ? parsed : undefined
```

---

### 3.3 Grok weekly window defaults to 0% on malformed data

**Severity:** Medium
**File:** `providers/grok.ts:65-66`
**Found by:** grok

Missing/malformed `creditUsagePercent` becomes 0% (healthy green) instead of being omitted. Monthly path correctly errors on bad shape; weekly path lies.

**Fix:** Only set `weeklyUsedPercent` when finite; otherwise leave undefined (skip the week window):
```ts
if (typeof raw === "number" && Number.isFinite(raw)) {
    usage.weeklyUsedPercent = raw;
}
```

---

### 3.4 Git ahead/behind can be NaN

**Severity:** Low
**File:** `git.ts:58-59`
**Found by:** grok

Garbage stdout → `parseInt` returns NaN → `hasRemote: true` with NaN counts. Both `NaN === 0` and `NaN > 0` are false → blank chip (not "synced", not counts).

**Fix:** Guard with `Number.isFinite`; fall back to `hasRemote: false` on parse failure.

---

### 3.5 Snapshot success retains stale "loading" message

**Severity:** Medium
**File:** `usage-snapshot.ts:122`
**Found by:** gpt-5.6-sol

`message: p.status ?? prev.message` — initial provider state contains `"loading"`. A valid `state: "ok"` record without optional `status` renders healthy quota plus "loading" text. Previous error messages likewise survive recovery.

**Fix:** When status is "ok" and `p.status` is undefined, clear the message:
```ts
const mappedStatus = STATE_TO_STATUS[p.state] ?? "unknown";
message: p.status ?? (mappedStatus === "ok" ? undefined : prev.message),
```

---

### 3.6 Loose "ok" validators accept empty JSON as success

**Severity:** Medium
**File:** `providers/codex.ts:6-9, 36-39`; `providers/umans.ts:20-21, 44-80`; `providers/kimi.ts:41-42, 94-120`
**Found by:** grok

`{}` and `[]` pass validation → maps to windows with undefined percents → UI shows `n/a` while `status: "ok"`. Contrast: Anthropic/Minimax/Openference validate required fields more tightly.

**Fix:** Require at least one recognized usage field before returning `status: "ok"`.

---

### 3.7 Response body not drained on early-throw paths

**Severity:** Medium (hygiene — socket accumulation under sustained 401/429 loops)
**File:** `providers/shared.ts:175-184`
**Found by:** opus

Redirect / auth-needed / http-error branches throw before `response.body` is read or cancelled. Undici connection reclaimed only via GC. Provider stuck in 401 loop re-hit every 60s accumulates held sockets.

**Fix:** Add `await response.body?.cancel().catch(() => {})` before each early throw.

---

### 3.8 Codex curl fallback follows redirects (contradicts fetch policy)

**Severity:** Low
**File:** `providers/codex.ts:50` (`"location"`) vs `providers/shared.ts:169` (`redirect: "manual"`)
**Found by:** grok, opus

Auth redirect can become 200 HTML → JSON.parse → `"bad json"` instead of `"auth-needed"`. Local curl 8.21 strips Authorization on cross-origin redirect (mitigated here), but no version floor guarantees this.

**Fix:** Drop `"location"` from curl config to match the stated policy.

---

### 3.9 `usage-snapshot.ts:102` accepts NaN as valid usedPercent

**Severity:** Low
**File:** `usage-snapshot.ts:102`
**Found by:** grok

`typeof w.usedPercent === "number"` is true for NaN. Add `&& Number.isFinite(w.usedPercent)`.

---

## Phase 4 — UX / Polish

### 4.1 Border skin drops scroll indicators

**Severity:** Medium
**File:** `render/editors/border.ts:53-54`
**Found by:** k3

The border skin replaces top/bottom border lines with `fitBorder(...)` output but never extracts the `↑ N more` / `↓ N more` indicators the parent drew there. Marker and boxed skins both preserve scroll cues; border-skin users get no signal that content exists above/below.

**Fix:** Extract scroll matches (as marker.ts:39/53 do) and pass ` ↑N ` / ` ↓N ` as a label into `fitBorder`.

---

### 4.2 In-flight refreshes survive session shutdown

**Severity:** Medium
**File:** `index.ts:686-702`
**Found by:** gpt-5.6-sol

Shutdown clears UI/timer state but neither aborts nor awaits provider promises. A replacement session immediately starts another refresh. Per-provider dedup guards are closure-local, so they don't deduplicate old/new instances. Can duplicate requests and race shared side effects (Anthropic cache writes, Codex credential persistence).

**Fix:** Track in-flight promises in a module-level Set; on shutdown, abort via AbortController or await with a short timeout before clearing state.

---

### 4.3 Openference `execFileSync` blocks agent_start

**Severity:** Low (measured 23ms typical; worst case 5s TUI freeze)
**File:** `providers/openference.ts:100-154`
**Found by:** gpt-5.6-sol

`copyFileSync` + `execFileSync("sqlite3", …, { timeout: 5000 })` runs synchronously before the first `await` in an async function, invoked from `agent_start`.

**Fix:** Convert to async `execFile` (callback or promisified). Low priority unless openference becomes a primary provider.

---

### 4.4 Narrow-width guards missing in marker/boxed skins

**Severity:** Low (pathological — terminals < 4 columns)
**File:** `render/editors/marker.ts` (no guard), `render/editors/boxed.ts` (guards width ≤ 0 only)
**Found by:** k3

At `width < 4`, marker: `markerWidth(3) + innerWidth(max 1) > width` → overflow. Boxed: at `width ≤ 2`, verticals make content lines `width + 1`.

**Fix:** `if (width < 4) return super.render(width);` fallback in both skins.

---

### 4.5 Marker early return skips `withEditorPadding`

**Severity:** Low
**File:** `render/editors/marker.ts:22`
**Found by:** k3

`if (lines.length < 2) return lines;` skips `withEditorPadding`, while boxed.ts:119-121 applies it on the equivalent early return. Nearly unreachable.

**Fix:** `return withEditorPadding(lines, deps.getPadding());`

---

## Phase 5 — Hygiene / Docs / Tests

### 5.1 AGENTS.md references deleted `cookies.ts`

**File:** `AGENTS.md` architecture tree + file inventory
**Found by:** opus

Still lists `cookies.ts ← Firefox cookies.sqlite reader`. The Firefox-reading subsystem now lives in `providers/openference.ts`. A reader auditing the trust model from docs reaches the wrong conclusion.

**Fix:** Update architecture tree and file inventory to reflect openference.ts.

---

### 5.2 Convention violations (`any`, `!`)

**File:** `providers/shared.ts:7, 219`; `index.ts:514`; `providers/anthropic.ts:125,127`; `providers/kimi.ts:106`
**Found by:** opus

AGENTS.md forbids `any` and `!`. Side note: `(err as any).name` at shared.ts:219 throws TypeError if err is nullish (cosmetic — callers degrade to "network").

---

### 5.3 Layout persistence regex matches comments in .jsonc

**File:** `config.ts:756, 793`
**Found by:** opus

`/"theme"\s*:\s*"[^"]*"/` matches the first occurrence anywhere, including commented-out lines. A `// "theme": "ocean"` above the real key gets rewritten instead.

---

### 5.4 Zero test coverage on critical paths

**Found by:** opus, k3, gpt-5.6-sol

Missing coverage:
- `writeAuth` / `persistCodexAuth` / `readAuth` / `fetchWithAuth` (credential path)
- Marker skin render closure with mocked 3-digit scroll offset (the Phase 0 blocker)
- Async refresh completion → render
- `session_tree` handler (once added)
- Shutdown during in-flight request
- Rejected refresh promises

---

### 5.5 `/hud status` omits Openference

**File:** `index.ts:858-867`
**Found by:** grok

Lists every other provider but not openference. Diagnostic gap only.

---

### 5.6 `package-lock.json` is gitignored

**File:** `.gitignore:6`
**Found by:** opus

Low risk (no runtime dependencies, only devDeps), but removes the reviewable-lockfile guarantee for source builds.

---

## Priority Order

| Phase | Items | Rationale |
|-------|-------|-----------|
| 0 | 0.1, 0.2 | TUI crash / process death — user-facing catastrophe |
| 1 | 1.1, 1.2, 1.3, 1.4 | Credential integrity — silent data loss |
| 2 | 2.1, 2.2 | Functional correctness — wrong data displayed |
| 3 | 3.1–3.9 | Robustness — edge cases, hygiene, latent hazards |
| 4 | 4.1–4.5 | UX polish — degraded experience, not broken |
| 5 | 5.1–5.6 | Hygiene — docs, tests, conventions |

**Estimated effort:** Phase 0+1 = ~2-3h focused work. Phase 2 = ~1h. Phases 3-5 = batchable, ~3-4h total.

---

## Notes on Reviewer Disagreements

- **writeAuth severity:** grok rated High, opus rated Blocker. Both independently identified the same root cause. Escalated to Blocker because the lost-update mode silently logs users out of unrelated providers with no error surface.
- **Openference blocking:** gpt-5.6-sol rated Medium (5s worst case), opus measured 23ms typical and rated Low. Settled on Low — the 5s is bounded by execFileSync timeout and the typical case is negligible.
- **reader.cancel():** opus flagged as High. Mechanism is verified (Node 24 unhandled rejection = exit), but the trigger requires the cancel promise itself to reject (rare). Kept at Blocker due to blast radius (entire Pi process, not just HUD).
