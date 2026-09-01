# Solid Diagnostics

> **Solid 2.0 (Release Candidate).** This package consumes the unstable `DEV` surface of `@solidjs/signals` and versions in lockstep with the rest of the fixed group. Every release may be breaking.

Agent-consumable diagnostics harness for Solid. Development builds of `@solidjs/signals` expose two channels: **diagnostics** (structured events for reactive anti-patterns — untracked reads, writes in owned scopes, lifecycle leaks, each with a stable code) and **attribution** (why every scope re-ran, what changed to cause it, and what it cost). This package captures both into a single serializable artifact and layers assertions, budgets, test matchers, and a browser bridge on top — so correctness, update granularity, and wasted recomputes become things a test suite or an AI agent can check mechanically instead of eyeballing.

**Dev-only.** Everything here requires a development build of `@solidjs/signals`; in production builds the `DEV` export is undefined and `captureArtifact` throws. Nothing from this package should ship in a production bundle.

## Capturing artifacts

`captureArtifact` runs a scenario with both channels open and folds what they saw into one artifact:

```ts
import { captureArtifact } from "@solidjs/diagnostics";
import { createRoot, createSignal, createMemo, flush } from "@solidjs/signals";

const { artifact } = await captureArtifact(
  () => {
    let setCount!: (v: number) => void;
    createRoot(() => {
      const [count, set] = createSignal(0, { name: "count" });
      setCount = set;
      createMemo(() => count() * 2, { name: "doubled" });
    });
    flush();
    setCount(1);
  },
  { scenario: "counter-update" }
);

artifact.diagnostics; // DiagnosticEvent[] — coded anti-pattern events
artifact.attribution; // { reruns, costs } — who re-ran, why, and what it cost
```

Options: `scenario` labels the artifact, `attribution: false` captures diagnostics only, and an options object is passed through to `DEV.attribution.enable()`. `artifactToJSONL(artifact)` emits line-oriented output for offline or agent-side analysis.

## Assertions and budgets

Assertion helpers take an artifact and throw `DiagnosticsAssertionError` with an explanatory message:

```ts
import {
  expectNoDiagnostics, // no anti-pattern events (allow list supported)
  expectDiagnostic, // a specific code was (or was expected to be) emitted
  expectRerunBudget, // no more than N re-runs, filterable by scope name
  expectNoWaste // no re-runs whose recompute produced an unchanged value
} from "@solidjs/diagnostics";

expectNoDiagnostics(artifact);
expectRerunBudget(artifact, 2, { name: "doubled" });
expectNoWaste(artifact);
```

Budgets make the same limits declarative and checked-in. A `ScenarioBudget` bounds diagnostics, re-runs (total or per-scope), and waste for a named scenario; `assertBudgetFile` validates a whole file of them:

```json
{
  "scenarios": {
    "counter-update": {
      "maxDiagnostics": 0,
      "maxReruns": { "doubled": 1 },
      "allowWaste": false
    }
  }
}
```

## Vitest matchers

Importing `@solidjs/diagnostics/vitest` (e.g. from a `setupFiles` entry) registers matchers that wrap the helpers:

```ts
expect(artifact).toHaveNoDiagnostics();
expect(artifact).toHaveDiagnostic("STRICT_READ_UNTRACKED");
expect(artifact).toStayWithinRerunBudget(2, { name: "doubled" });
expect(artifact).toHaveNoWaste();
expect(artifact).toStayWithinBudget(budget);
```

## Browser capture

The same artifacts can be captured from a real page. `@solidjs/diagnostics/browser` installs an in-page bridge on `globalThis.__SOLID_DIAGNOSTICS__` — it must be bundled **with the app** so it shares the app's `@solidjs/signals` instance:

```ts
// dev entry
import { installDiagnosticsBridge } from "@solidjs/diagnostics/browser";
installDiagnosticsBridge();
```

`@solidjs/diagnostics/playwright` drives that bridge from Node. It is typed structurally against `page.evaluate`, so Playwright is not a dependency — any page-like object works:

```ts
import { captureBrowserArtifact } from "@solidjs/diagnostics/playwright";

const { artifact } = await captureBrowserArtifact(
  page,
  async page => {
    await page.click("#add-todo");
  },
  { scenario: "add-todo" }
);
```

The bridge also answers live queries against an open session — `whyDidRun(name)` returns the recorded re-runs of one scope, and `costs()` returns the running cost tables without closing the capture.

## Dev-server endpoint

`@solidjs/vite-plugin` can inject the bridge and expose capture control over HTTP at `/__solid/diagnostics` (its `diagnostics` option), letting out-of-process tools — including agents — begin/end captures and run live queries against a running dev server. `@solidjs/diagnostics/protocol` publishes the wire types for that endpoint; the plugin re-declares the literals against these types so the two release independently without drifting.

## Skills

The package ships machine-readable guides under `skills/` (npm-installed alongside the code, so they version with the API):

- `skills/agent-loops/SKILL.md` — how an agent runs the generation, acceptance, and attribution loops against artifacts and the dev-server endpoint.
- `solid-js/skills/reactivity-diagnostics/SKILL.md` (in the `solid-js` package) — the repair guide mapping every diagnostic code to its prescribed fix.
