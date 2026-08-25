# Agent loops with @solidjs/diagnostics

Solid's dev builds expose two evidence channels — rule diagnostics (stable
codes for known anti-patterns) and attribution (per-re-run causality with
timing and waste accounting). This package captures both into one
serializable artifact. Use it to verify claims about reactive code instead
of inferring them from reading it.

There are three loops. Each takes the same fixture:

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
  scopes: { TodoRow: 1 } // per-scope caps; "/regex/" keys also work
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
that should be split, or a hot value that needs `createSelector`/projection
inversion. Re-capture after each change and diff the rerun counts — the
artifact is the before/after evidence.

## Practical rules

1. **Name your scopes.** Pass `{ name }` to `createSignal`/`createMemo`/
   `createEffect` in code under test. Attribution is only as readable as the
   names in it — anonymous nodes are unactionable.
2. **One interaction per scenario.** Budgets are meaningful when the
   scenario is a single user-visible action (one click, one keystroke, one
   landing async value).
3. **Egress for offline analysis.** `artifactToJSONL(artifact)` emits one
   JSON record per line (`meta`, `diagnostic`, `rerun`, `costs`) — grep it,
   diff it between runs, attach it to a report.
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
curl -X POST localhost:3000/__solid/diagnostics -d '{"method":"end"}'
```

`GET` the endpoint for status. With several open tabs the first responder
wins — keep one page under test.
