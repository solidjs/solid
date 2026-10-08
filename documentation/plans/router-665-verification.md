# solid-router #665 — pre-release verification on the HackerNews SC twin

_Measured 2026-10-08 against solid-router `457ac72` (unreleased, head of `next`;
latest published is `2.0.0-next.37`). Docs only; no source changes, nothing
merged or published. Owner: Ryan._

## Verdict

**Insufficient as an answer to #665, though correct as a fix for what it
targets.** The per-anchor link-claim cost at load on `/stories/30186326`
(1,475 anchors) is **≈ 11–12 ms before and ≈ 11–12 ms after** against the
router the SC twin actually pins (`2.0.0-next.29`, the version the issue was
measured on). What `457ac72` removes is a **≈ 4–5 ms regression that
`next.30`–`next.37` had added on top of that** (`comparablePath` now goes
through `new URL`, and `matchLink` re-parsed the location and base per anchor):
`next.37` → fix is 64.9 → 60.7 ms of page script, `next.29` is 61.1 ms. The
cost is not deferred or moved anywhere; it is simply still there, at claim
time, ≈ 7.8 µs per anchor, ≈ 19 % of this page's script on today's `next`.

| per-anchor link claims at load, this page                 | `next.29` (pinned) | `next.37` (parent) | `457ac72` (fix) |
| --------------------------------------------------------- | -----------------: | -----------------: | --------------: |
| `URL` constructions per anchor                            |                  1 |            ≈ 3.7–4 |               2 |
| `refresh` inclusive, 100 µs profile (median of 3)         |            11.9 ms |            16.4 ms |         12.3 ms |
| page script, unprofiled trace (median of 15, interleaved) |            61.1 ms |            64.9 ms |         60.7 ms |
| same, with link claims disabled in the fix build          |                  — |                  — |         49.4 ms |

What remains, and where (fix build, 100 µs profile, ≈ 12.3 ms inclusive):

- `managedUrl` ≈ 8.5 ms — the per-anchor `new URL(href, document.baseURI)`
  (≈ 3.3 ms; the relative resolution against `baseURI` is the expensive
  constructor, not the absolute `mockBase` one) plus ≈ 4.2 ms of its own
  attribute reads and URL getters (`getAttribute("href"|"rel")`, `.target`,
  `hasAttribute("download")`, `rel.split(/\s+/)`, `url.origin`,
  `window.location.origin`, `url.pathname`, `isUnderBase`).
- the matcher closure ≈ 2.7 ms — `comparablePath(target)` ≈ 2.3 ms (its
  `new URL(mockBase + …)` is only ≈ 0.4 ms of that; `normalizePath`'s regexes
  and the `.toLowerCase().replace()` chain are the rest).
- `linkState` self + `apply` + `untrack` ≈ 1 ms.

The two ideas the issue proposed are the ones that would take this to the
≤ 0.5 ms range, and the fix's closing comment declines both for stated reasons
(server HTML carries no link state so `aria-current`/`data-active` must be
correct at load; a string pre-check would duplicate URL normalization). If
those reasons stand, the remaining ≈ 11 ms is a cost `next` accepts on this
page; if not, the budget above says where the next ≈ 8 ms is (`managedUrl`,
not `comparablePath`).

## The fix

[solidjs/solid-router@457ac72](https://github.com/solidjs/solid-router/commit/457ac72794f7a399de153b7dcee5916b3af379f8)
— "perf(claims): parse location and base once per link sweep (#665)", on
`next`, parent `a9e2f6a` (the `next.37` release commit). Changeset: patch.
Issue [#665](https://github.com/solidjs/solid-router/issues/665) closed with
the commit.

`matchLink(location, target, base, end)` becomes
`linkMatcher(location, base, end)(target)`: the location's `comparablePath`
and the base's are computed once when the matcher is built, and the returned
closure does only the per-target work (`comparablePath(target)`, the
exact/prefix test, `comparableQuery` on exact match). `setupLinkClaims` caches
one matcher keyed on `location.pathname + location.search`, so the claim-time
pass and each navigation sweep share it; `useLinkState` and `linkPending`
build one per evaluation. Per anchor that is ≈ 2 `URL` constructions instead
of ≈ 4 (`managedUrl`'s `new URL(href, baseURI)` plus `comparablePath(target)`;
the location, base and — on `next.37` — their re-parses are gone). +22 B
gzipped. Nothing is deferred: link state is still computed for every claimed
anchor at claim time.

## Method

Reproduces the twins agent's method (its run: both twins at
`/stories/30186326`, `npx vite build --minify false`, each example's
`server.js`, Cursor's Chromium, `Performance.getMetrics` reload-to-reload
deltas, `Profiler.setSamplingInterval 100`), with two deliberate changes
noted under Caveats: a standalone Chrome instead of the Cursor tab (another
agent was profiling this page in it concurrently), and a Chrome trace for the
unprofiled script figure because this Chrome's `ScriptDuration` counter does
not include the page's microtask work.

- **App**: `/Users/ryancarniato/Development/solid/examples/hackernews` (the
  SC twin; `serverFunctions: { components: true }`), solid checkout
  `4f83ee9aa`, packages `dist` built 2026-10-07 15:58, `@solidjs/vite-plugin
3.0.0-next.35`, vite 8.1.5. Built four times with
  `npx vite build --minify false`, swapping only the router:
  - `n29` — `@solidjs/router 2.0.0-next.29`, the example's pin (baseline).
  - `n37` — solid-router `a9e2f6a` built from source (the fix's parent).
  - `fix` — solid-router `457ac72` built from source.
  - `fix-noclaims` — `fix` with the anchor branch of the claim callback
    removed (`claims.js` only), to measure the whole link-claim cost
    unprofiled by subtraction.
    The swap is a symlink: `examples/hackernews/node_modules/@solidjs/router` →
    a staged package dir with the built `dist` and sibling `solid-js` /
    `@solidjs/web` symlinks to the same `packages/solid` and `packages/web` the
    example uses, so one copy of each. Symlink restored and the example's prior
    `dist` put back afterwards; the solid checkout's `git status` is clean.
- **Serving**: each build's `dist` plus the example's `server.js` copied to
  `.wt/router665/builds/<variant>/` (with a `node_modules` symlink to the
  example's), `PORT=3204..3207 node server.js`. Story 30186326 is served from
  the example's captured JSON, so the document is byte-stable
  (1,179,536 B decoded, 240 KB brotli; 1,475 `a[href]`, 1,406 `.comment`,
  11,05x elements).
- **Browser**: Google Chrome 154.0.8037.98 (headless, 1280×2000) via
  puppeteer-core 25.12.0, warm cache, 1.5 s settle after `load` plus two
  rAFs.
- **Metrics**: `Performance.getMetrics` after each warm reload; in this
  Chrome the counters are per-document (they reset on navigation), so the
  raw value after a reload is that load. A 50 ms `page.evaluate` busy loop
  adds 50 ms to `TaskDuration` and 0 to `ScriptDuration`, and 53 ms of this
  page's work runs inside `RunMicrotasks` — `ScriptDuration` reads ≈ 7–8 ms
  for a load whose profile shows ≈ 60 ms of JS. So **script is taken from a
  trace**: `devtools.timeline` + `v8` categories per reload, main-thread
  union of `v8.evaluateModule` / `EvaluateScript` / `FunctionCall` /
  `RunMicrotasks` / timer and event callbacks / `v8.compile*`, minus nested
  GC; `MainThread` is the union of `RunTask`; `Style+Layout` is
  `UpdateLayoutTree` + `Layout` + `PrePaint` + `Layerize`.
- **Profiles**: `Profiler.setSamplingInterval 100`, one profile per warm
  reload, three per variant, plus one of the first client-side navigation
  (click the first `/users/…` link). Inclusive times count a sample once
  per distinct frame on its stack.
- **Reloads**: one sequential pass of 7 per variant, a second of 7 in
  reverse order, then an interleaved pass (n29 → fix → fix-noclaims → n37,
  3 reloads each, × 5) because the machine is noisy (load average ≈ 4,
  screen streaming). Medians and minimums are reported; means are pulled
  up by outliers.

## Baseline on this machine vs the twins agent

Twins agent (SC twin, `next.29`, Cursor Chromium, 2026-10-07 — profile
`~/.cursor/browser-logs/cdp-profile-Profiler.stop-2026-10-07T17-17-12-688Z.json`):
Task ≈ 156 ms, Script ≈ 31 ms, Layout + style ≈ 48 ms; profile `hydrate()`
inclusive 34.2 ms, `linkState` 11.9, `managedPath` 9.6, `comparablePath` 2.2,
`URL` self 2.8, `collectSlots` 8.1 + `slotPositions` 2.0 +
`collectRegionElements` 0.9, `Toggle` 2.3.

This machine, `n29` build:

| `Performance.getMetrics`, raw per load (median of valid rows) |    twins |                                           here |
| ------------------------------------------------------------- | -------: | ---------------------------------------------: |
| TaskDuration                                                  | ≈ 156 ms |                                       149.5 ms |
| LayoutDuration + RecalcStyleDuration                          |  ≈ 48 ms |                                  40.0 + 5.7 ms |
| ScriptDuration                                                |  ≈ 31 ms | 7.7 ms (counter undercounts here — see Method) |

| trace, `n29`, 15 interleaved reloads |   median |      min |
| ------------------------------------ | -------: | -------: |
| main thread (`RunTask` union)        | 157.0 ms | 137.1 ms |
| script (no GC)                       |  61.1 ms |  57.9 ms |
| GC                                   |   6.3 ms |   1.2 ms |
| style + layout                       |  53.8 ms |  50.3 ms |
| ParseHTML                            |   8.2 ms |   7.6 ms |

| 100 µs profile, `n29`, inclusive ms (3 reloads)    | twins | here: 1 / 2 / 3    |
| -------------------------------------------------- | ----: | ------------------ |
| claim callback → `refresh` (whole per-anchor cost) |     — | 11.9 / 11.6 / 12.4 |
| `linkState`                                        |  11.9 | 11.3 / 11.3 / 12.3 |
| `managedPath`                                      |   9.6 | 6.3 / 8.4 / 9.9    |
| `comparablePath`                                   |   2.2 | 1.7 / 2.4 / 2.2    |
| `URL` (self)                                       |   2.8 | 1.4 / 2.3 / 2.4    |
| `hydrate()`                                        |  34.2 | 7.9 / 7.8 / 7.9    |
| `collectSlots`                                     |   8.1 | 13.4 / 12.9 / 12.7 |
| `gatherHydratable` (≈ all `querySelectorAll`)      |     — | 26.4 / 27.9 / 28.3 |
| `Toggle` (652)                                     |   2.3 | 2.1 / 2.9 / 2.8    |

The router lines match the twins agent's profile to within a millisecond
(`linkState` ≈ 11–12 ms both), so the per-anchor measurement is the same
measurement. The page around it is not: the solid checkout moved between the
twins agent's build and this one, and this build has ≈ 26 ms in
`gatherHydratable` → `querySelectorAll` (from `hydrateWindow`) that the twins
agent's profile does not (its `querySelectorAll` was 2.3 ms), while
`hydrate()` here is the 7–9 ms of component hydration only — `collectSlots`
runs from `FrameImpl`/`#flush`, not under `hydrate()`. That is why script is
≈ 60 ms here and ≈ 31 ms there; it is outside this verification but flagged
under Caveats.

## Before / after

Unprofiled, trace-based, interleaved pass (15 reloads per variant, median /
min, ms):

| variant                 |   main thread |  script (no GC) |  GC | style + layout | ParseHTML |
| ----------------------- | ------------: | --------------: | --: | -------------: | --------: |
| `n29` (pinned baseline) | 157.0 / 137.1 | **61.1** / 57.9 | 6.3 |    53.8 / 50.3 |       8.2 |
| `n37` (fix's parent)    | 164.6 / 141.2 | **64.9** / 61.7 | 7.6 |    53.5 / 50.4 |       8.2 |
| `fix` (`457ac72`)       | 160.8 / 137.2 | **60.7** / 58.3 | 6.4 |    53.4 / 50.6 |       8.3 |
| `fix-noclaims`          | 146.0 / 123.1 | **49.4** / 46.0 | 6.0 |    55.4 / 49.9 |       9.3 |

The two sequential passes (14 reloads per variant) agree: script median / min
`n29` 58.7 / 57.0, `n37` 63.7 / 60.4, `fix` 59.1 / 57.4.

Deltas (interleaved medians; the sequential passes in parentheses):

- `fix` − `n37`: **−4.2 ms** of script (−4.6) — the fix does what it says
  against its parent.
- `fix` − `n29`: **−0.4 ms** (+0.4) — indistinguishable from the version the
  SC twin pins and the issue measured.
- `fix` − `fix-noclaims`: **+11.3 ms** (min-to-min +12.3) — the whole
  link-claim cost that remains at load, unprofiled: ≈ 7.8 µs per anchor,
  ≈ 19 % of this page's script.
- `n37` − `n29`: **+3.8 ms** (sequential +5.0) — the regression the fix
  undoes. Layout, style and parse are flat across all four, as expected for
  a router-only change.

`Performance.getMetrics` (raw per load, median of valid rows; `ScriptDuration`
is the undercounting counter and is listed only for completeness):

| variant | TaskDuration | LayoutDuration | RecalcStyleDuration | ScriptDuration |
| ------- | -----------: | -------------: | ------------------: | -------------: |
| `n29`   |        149.5 |           40.0 |                 5.7 |            7.7 |
| `n37`   |        148.4 |           39.6 |                 5.5 |            8.4 |
| `fix`   |        153.1 |           39.5 |                 5.5 |            7.3 |

## Profile attribution

100 µs sampling, one warm reload per profile, three per variant; inclusive ms
unless marked self; the three values are the three profiles.

| function                                                 | `n29`                     | `n37`              | `fix`              |
| -------------------------------------------------------- | ------------------------- | ------------------ | ------------------ |
| claim callback (`registerElementClaim` handler, anchors) | 12.6 / 11.8 / 12.8        | —                  | 13.0 / 12.9 / 12.8 |
| `refresh`                                                | 11.9 / 11.6 / 12.4        | 16.4 / 16.8 / 15.2 | 12.2 / 12.5 / 12.3 |
| `linkState`                                              | 11.3 / 11.3 / 12.3        | 15.9 / 16.3 / 15.0 | 12.1 / 12.1 / 12.2 |
| `managedPath` (n29) / `managedUrl`                       | 6.3 / 8.4 / 9.9           | 7.0 / 8.0 / 6.3    | 8.5 / 8.9 / 7.6    |
| `managedPath` / `managedUrl` self                        | 4.0 / 4.2 / 5.4           | 3.7 / 3.4 / 3.8    | 4.5 / 4.0 / 4.2    |
| `matchLink` (n37) / matcher closure (fix)                | — (inline in `linkState`) | 8.1 / 8.2 / 8.0    | 2.7 / 2.6 / 3.1    |
| `comparablePath`                                         | 1.7 / 2.4 / 2.2           | 7.3 / 7.3 / 7.4    | 2.2 / 2.3 / 2.7    |
| `normalizePath`                                          | 0.9 / 0.9 / 1.4           | 1.1 / 1.2 / 1.0    | 0.3 / 0.9 / 0.1    |
| `isUnderBase`                                            | —                         | 0.8 / 0.5 / 0.0    | 0.3 / 0.1 / 0.1    |
| `URL` self, all sites                                    | 1.4 / 2.3 / 2.4           | 4.3 / 7.1 / 6.0    | 4.7 / 3.7 / 4.0    |
| `URL` under `managedPath`/`managedUrl` (profile 2)       | 2.3                       | 3.0                | 3.3                |
| `URL` under `comparablePath` (profile 2)                 | 0                         | 4.0                | 0.4                |
| `setupLinkClaims`                                        | 0 (setup only)            | 0                  | 0                  |
| `hydrate()`                                              | 7.9 / 7.8 / 7.9           | 8.3 / 8.7 / 8.9    | 7.5 / 7.3 / 7.3    |
| `collectSlots`                                           | 13.4 / 12.9 / 12.7        | 11.8 / 12.8 / 11.1 | 10.6 / 10.6 / 12.4 |
| `gatherHydratable`                                       | 26.4 / 27.9 / 28.3        | 27.4 / 26.3 / 29.8 | 27.8 / 26.6 / 26.9 |
| `Toggle`                                                 | 2.1 / 2.9 / 2.8           | 3.9 / 2.8 / 2.4    | 3.3 / 3.5 / 3.3    |
| non-idle self total (profile)                            | 64.4 / 65.2 / 65.7        | 69.2 / 68.4 / 68.3 | 64.0 / 62.5 / 63.3 |

Reading it:

- All `refresh` time at load is on the per-claim path (`claimTree` →
  `claimNode` → claim callback → `refresh`); the initial run of the registry
  render effect contributes nothing measurable in any variant — anchors are
  not registered yet when it first runs, so there is no double evaluation.
- `n37` vs `n29`: `comparablePath` goes 2.2 → 7.3 ms because it now builds a
  `URL` and `matchLink` calls it three times per anchor (location, target,
  base); `URL` self 2.3 → 6.0.
- `fix` vs `n37`: `matchLink`'s 8.1 ms becomes the closure's 2.7 ms;
  `comparablePath` is back to 2.3 ms (one call per anchor); `URL` under
  `comparablePath` 4.0 → 0.4 ms. `managedUrl` is untouched at ≈ 8.5 ms and is
  now ≈ 70 % of the remaining cost.
- `fix` vs `n29`: `refresh` 12.3 vs 11.9 ms — the extra `URL` inside
  `comparablePath` (≈ 0.4 ms) roughly cancels the string work `next.29`'s
  `linkState` did (`decodeURI` + two string `comparablePath`s).
- Nothing else moved. The profile's non-idle total moves with `refresh` and
  nothing else (`n37` ≈ +3 ms over `n29`, `fix` ≈ −2 ms, with a ± 1.5 ms
  profile-to-profile spread), the unprofiled script deltas say the same, and
  `hydrate()`, `collectSlots`, `gatherHydratable`, `Toggle` are flat within
  their reload-to-reload spread. The router's own setup
  (`setupLinkClaims`, `createRouter`) does not register at 100 µs.

### First client-side navigation

Nothing is deferred, so there is no load → navigation trade to report. For
completeness, one profiled click on the first `/users/…` link from the story
page:

|                                           |   `n29` |   `n37` |   `fix` |
| ----------------------------------------- | ------: | ------: | ------: |
| `refresh` inclusive during the navigation | 3.95 ms | 0.00 ms | 0.04 ms |
| navigation TaskDuration (one sample)      | 52.9 ms | 44.7 ms | 35.0 ms |

`next.29`'s claims effect tracked `router.isRouting()`, which flips at
navigation start while the 1,475 old anchors are still mounted, so it swept
them all (3.95 ms). By `next.37` the effect tracks `location.pathname` /
`search` (and `plugin.track()` only with the `pendingLinks` opt-in), which
commit with the new page — the sweep sees the 8 new anchors. So on this app
the fix's "shared parse per navigation sweep" has nothing to save; it would
show in an app that opts into `pendingLinks`, where the sweep over the old
page's anchors still happens at navigation start. The TaskDuration spread is
frames teardown (`contentHTML`, `remove` of the 11k-node page), single
samples, not router.

## Caveats

- **Version gap.** The SC twin pins `2.0.0-next.29`; the fix is on top of
  `next.37`. The issue's "≈ 6 ms" was measured on `next.29`. Between them
  `comparablePath` became URL-based and `matchLink` was introduced, which is
  the ≈ 4–5 ms the fix removes. Upgrading the twin to `next.38` (when cut)
  will land it where `next.29` is on this cost, not below.
- **"≈ 6 ms" is ≈ 11–12 ms.** The issue's figure appears to be the
  `managedPath` + `URL` self time; the inclusive `linkState` in the twins
  agent's own profile was 11.9 ms, and the unprofiled removal measurement
  here (`fix` − `fix-noclaims`) is 11.3–12.3 ms. The per-anchor claim cost on
  this page is about twice what the issue stated, before and after.
- **Browser.** Google Chrome 154 headless via puppeteer-core, not the Cursor
  Chromium tab — another agent was actively profiling this same page in the
  Cursor browser during this run (profiles at 09:08 and 09:11 UTC in
  `~/.cursor/browser-logs/`), and sharing the tab would have corrupted both
  runs. Same engine, same CDP methods. Headless `TaskDuration` and layout
  match the twins agent's headful numbers to within ≈ 5 %.
- **`ScriptDuration` is not the script figure here.** Documented under
  Method; the trace union is. Anyone re-running on this Chrome should not
  read the `getMetrics` script column.
- **The page is not the twins agent's page.** Same app, same document, but
  solid `4f83ee9aa` with `@solidjs/web` built 2026-10-07 15:58: ≈ 26 ms of
  `gatherHydratable` → `querySelectorAll` from `hydrateWindow` (the
  `[_hk^="…"]` prefix selects, one per occurrence, over the whole element)
  that was not in the Oct 7 profile. It is the single largest JS item on the
  page now, larger than the frames walk and the link claims together. Not
  part of this verification; it should be looked at separately.
- **Noise.** Load average ≈ 4 during the run (screen streaming). Reload
  medians across sequential and interleaved passes agree within ± 1 ms for
  script; means do not and are not used. `fix` vs `n29` is inside that band
  and is reported as "no change", not as a 0.4 ms improvement.
- **Profiler overhead** at 100 µs is ≈ 5–8 % on this page (profile non-idle
  self ≈ 64 ms vs trace script ≈ 60 ms), so inclusive figures are slightly
  high; the unprofiled subtraction is the authoritative per-anchor total.

## Artifacts

All under `/Users/ryancarniato/Development/solid-size-audit/.wt/` (git-excluded):

- `solid-router/` — clone, checked out at `457ac72`; `a9e2f6a` was built
  from the same clone.
- `router665/pkgs/{n37,fix,fix-noclaims}/node_modules/@solidjs/router` —
  the staged router packages (built `dist` + `package.json`), each with
  `COMMIT`; sibling `solid-js` / `@solidjs/web` symlinks into
  `/Users/ryancarniato/Development/solid/packages`.
- `router665/builds/{n29,n37,fix,fix-noclaims}/` — the four unminified SC
  twin builds (`dist/`, `server.js`, `node_modules` → the example's); run
  with `PORT=… node server.js`. Build logs `router665/build-*.log`.
- `router665/profiles/*.cpuprofile` — CPU profiles (`<variant>-reload-{1,2,3}`,
  `<variant>-nav`); load in DevTools → Performance → Load profile.
  `*-metrics.json` has the `getMetrics` rows.
- `router665/traces/**/*.trace.json` — Chrome traces (`<variant>-reload-N`
  sequential, `run2/` reverse pass, `il/<variant>-b<batch>-reload-N`
  interleaved); `trace-summary*.log` are the tables above.
- `router665/{measure,trace,trace-analyze,attrib,callers,probe-metrics}.mjs`
  — the harness (puppeteer-core in `router665/node_modules`).
- `router665/dist-prior/` — the example's `dist` as found (minified, Oct 7
  15:58), which is what is back in `examples/hackernews/dist` now.
- `router665/router-symlink-original.txt` — the symlink target that was
  restored.
