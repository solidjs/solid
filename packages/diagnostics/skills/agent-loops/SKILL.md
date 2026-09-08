# Agent loops with @solidjs/diagnostics

Solid's dev builds expose two evidence channels — rule diagnostics (stable
codes for known anti-patterns) and attribution (per-re-run causality with
timing and waste accounting). This package captures both into one
serializable artifact. Use it to verify claims about reactive code instead
of inferring them from reading it.

There are four loops. Each takes the same fixture:

```ts
import { captureArtifact } from "@solidjs/diagnostics";

const { artifact } = await captureArtifact(
  () => {
    // mount a tree or exercise a store, then perform the interaction
    // under test; flush() happens automatically at the end
  },
  { scenario: "todo-toggle" }
);
```

## Loop 1 — Generation (write code until the channel is quiet)

After generating or porting a component, run its scenario and read
`artifact.diagnostics`. Every event has a stable `code`; the
`reactivity-diagnostics` skill shipped in `solid-js` maps each code to its
repair. Fix, re-capture, repeat until zero events. Do not allowlist a code
you have not understood — each one is a real defect or a real cost.

```ts
import { expectNoDiagnostics } from "@solidjs/diagnostics";
expectNoDiagnostics(artifact); // throws with the offending events as evidence
```

## Loop 2 — Acceptance (scenario + budget = definition of done)

A component is done when a named scenario stays within an explicit budget.
Budgets are machine-checkable, so "the port is granular" stops being a
judgment call:

```ts
import { assertBudget } from "@solidjs/diagnostics";

assertBudget(artifact, {
  allow: [], // tolerated diagnostic codes
  maxReruns: 2, // total re-run cardinality for the scenario
  maxWastedRuns: 0, // unchanged recomputes (plain, non-held)
  scopes: { TodoRow: 1 }, // per-scope caps; "/regex/" keys also work
  maxSilentHoldMs: 0 // every hold the interaction caused was acknowledged on screen
});
```

Budgets belong in a checked-in JSON file (see `parseBudgetFile`) so CI owns
them and a regression is a test failure, not a review comment. In Vitest,
import the matchers for inline use:

```ts
import "@solidjs/diagnostics/vitest";

expect(artifact).toHaveNoDiagnostics();
expect(artifact).toStayWithinRerunBudget(2, { scope: /TodoRow/ });
expect(artifact).toHaveNoWaste();
```

## Loop 3 — Attribution (why did this run → targeted refactor)

When a budget fails or something feels slow, do not guess — read the
causality:

- `artifact.attribution.reruns[]` — each re-run: `nodeName`, `causes`
  (change chain back to the root write), `selfMs`, `changed`, `phase`.
  A run with `changed: false` and `phase: "plain"` was pure waste.
- `artifact.attribution.costs.scopes` — scopes ranked by self-time with
  `wastedMs`; `costs.writes` — root writes ranked by downstream cost.

Start from the top of the cost tables. The usual repairs: a missing memo
boundary (waste), an unstable memo output (fan-out amplifier), a wide read
that should be split, or a hot value that should be inverted into a store
used as a map keyed by id. Re-capture after each change and diff the rerun counts — the
artifact is the before/after evidence.

## Loop 4 — Responsiveness (the click did something, visibly)

Solid holds a write that lands on async work until the data settles, so the
screen never tears. That is correct — and from the user's side the click did
nothing until the data came back unless something on screen acknowledged the
wait. Agents systematically skip the affordances that do this (`isPending`,
`latest`, `createOptimistic`); this loop makes the omission a test failure.

Set `maxSilentHoldMs: 0` on every scenario that is a user interaction, or
assert directly:

```ts
import { expectNoSilentHolds } from "@solidjs/diagnostics";
expectNoSilentHolds(artifact); // fails with the hold: interaction, held write, blocker, duration
```

When it fails, read `artifact.attribution.feedback.sources` first — the
ranked table of what users waited on: per async source, how many holds, how
many silent, `acknowledgedBy` (which affordance answered, in how many holds),
and which interactions were held. A source acknowledged in some holds and
silent in others means the affordance exists on one screen and is missing on
another; add it where the silent holds happen. Then repair by shape, in this
order:

1. **Show the wait** — read `isPending(() => blocker())` (the blocker is
   named in the failure) in the affected UI and render a busy state.
2. **Reveal the input** — `latest(heldSource)` shows the new value of the
   held write (page number, filter, query) immediately while data catches up.
3. **Predict the outcome** — `createOptimistic`/`createOptimisticStore`
   written alongside the real write (or inside the action) shows the expected
   result now and reverts on failure. For actions this is the primary repair.

Anti-repair: never make the assertion pass by moving the write off the async
path, wrapping it in `untrack`, or splitting the read so the write "commits
faster". That trades a hold for a torn screen and is the bug the hold exists
to prevent. `expectHoldBudget(artifact, ms)` is the separate latency gate —
acknowledged or not, no hold may outlast it — for mocked sources that should
settle within a known time.

`artifact.attribution.feedback.interactions` is the INP-shaped view: per user
event, the synchronous re-run work one dispatch caused (`worstDispatchMs` —
fix through Loop 3) beside the time its writes spent held (`worstHoldMs`,
`silentMs` — fix here). In browser captures the interaction is stamped by the
web runtime; in-process, wrap the write in
`DEV.attribution.withInteraction({ type, target }, () => …)` so holds are
measured from the event and keyed by it.

Two more fact tables in `feedback` have no verdict of their own; read them
when a scenario is slow without being silent:

- `flights` — per async source, `flights`/`landed`/`abandoned`. A source that
  abandons most of its flights re-asks on every input change (search as you
  type); put a debounced or equality-gated derivation between the input and
  the fetch. `long`/`longMs` on a `sources` row is the sibling fact: the
  hold's tail (last input → commit) ran past the long-hold threshold,
  acknowledged or not — the `LONG_HOLD` shape. A spinner over stale content
  is not the answer at that length: key a `Loading` boundary with `on` so the
  fallback shows, or preload/cache so the wait never gets there.
- `fallbacks` — per loading boundary, `shows`/`shownMs`/`flashes`. A flash
  (under 150ms) is a spinner that appeared and vanished; preload, cache, or
  lift the fetch above the boundary. Do not add artificial delay.

Loop 4's structural siblings live in Loop 2's diagnostics list:
`EFFECT_RELAY_TEAR` (derived state via effect — a reader ran twice for one
write, the first frame inconsistent; make it a memo), `IMMUTABLE_UPDATE_IN_STORE`
(spread-copy store writes — mutate the draft or `reconcile`), and
`UNSTABLE_LIST_IDENTITY` (a list rebuilt for equivalent records — key by a
stable field or `reconcile`). Each names its repair in the message.

## Practical rules

1. **Name your scopes.** Pass `{ name }` to `createSignal`/`createMemo`/
   `createEffect` in code under test. Attribution is only as readable as the
   names in it — anonymous nodes are unactionable.
2. **One interaction per scenario.** Budgets are meaningful when the
   scenario is a single user-visible action (one click, one keystroke, one
   landing async value).
3. **Egress for offline analysis.** `artifactToJSONL(artifact)` emits one
   JSON record per line (`meta`, `diagnostic`, `rerun`, `costs`, `hold`,
   `feedback`) — grep it, diff it between runs, attach it to a report.
4. **Dev builds only.** `captureArtifact` throws where the `DEV` export is
   stripped. Run under Vitest or a dev server.
5. **Browser capture uses the same artifact.** For real pages, import
   `@solidjs/diagnostics/browser` in the app's dev entry, call
   `installDiagnosticsBridge()`, and drive it with `captureBrowserArtifact`
   from `@solidjs/diagnostics/playwright` (works with any page object that
   has a Playwright-compatible `evaluate`). Every assertion and budget above
   works unchanged on browser-captured artifacts.
6. **Live queries need no test harness at all.** With
   `@solidjs/vite-plugin`'s `diagnostics: true` option, the dev server
   injects the bridge automatically and serves `/__solid/diagnostics`:

```sh
curl -X POST localhost:3000/__solid/diagnostics -d '{"method":"begin"}'
# ...interact with the app in the browser...
curl -X POST localhost:3000/__solid/diagnostics -d '{"method":"whyDidRun","params":{"name":"TodoRow"}}'
curl -X POST localhost:3000/__solid/diagnostics -d '{"method":"costs"}'
curl -X POST localhost:3000/__solid/diagnostics -d '{"method":"feedback"}'
curl -X POST localhost:3000/__solid/diagnostics -d '{"method":"end"}'
```

`GET` the endpoint for status. With several open tabs the first responder
wins — keep one page under test.
