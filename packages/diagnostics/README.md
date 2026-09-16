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
artifact.attribution; // { reruns, costs, holds, feedback } — who re-ran, why, what it cost, what the user waited on
```

`attribution.holds` lists every hold the scenario caused — a write that landed on async work and stayed staged until the data settled — with what was held, what blocked it, how long the user waited (measured from the interaction when the web runtime stamped one), and which affordances acknowledged it (`isPending:posts`, `latest:page`, `optimistic:todos`, `affects:list`) or none. `attribution.feedback` folds those into ranked tables: `sources` (per async source: holds, silent ms, acknowledged-by counts, long holds (tail past the long-hold threshold), the interactions held), `interactions` (per user event: re-run work caused beside time held — the two INP hazards on one row), `flights` (per async source: flights started, landed, and abandoned before landing — the re-ask storm) and `fallbacks` (per loading boundary: time its fallback was shown, and how often that was a sub-150ms flash).

Options: `scenario` labels the artifact, `attribution: false` captures diagnostics only, and an options object is passed through to the engine's `enable()` (`@solidjs/signals/attribution`). `artifactToJSONL(artifact)` emits line-oriented output for offline or agent-side analysis.

**Clocks.** Every `at` in the artifact — a re-run's start, a hold's, a record's — is on the capturing process's `performance.now()` clock; `artifact.timeOrigin` (epoch milliseconds, the process's `performance.timeOrigin`) anchors it, so `timeOrigin + at` is the absolute time of anything in the artifact and two captures from one process line up. Durations (`selfMs`, `holdMs`, `durationMs`) are already relative. Re-runs are stored as the engine emits them: `nodeId` names the scope (stable across its runs in the process, distinct between scopes), so runs of unnamed effects still fold to one scope offline; the live node never leaves the process (in-process, `OBSERVE.subjectOf(rerun)` hands it back).

### Records: server renders and browser requests

Beside findings and attribution the artifact carries **records** — `artifact.records`, the runtimes' `OBSERVE.records` channel folded into one table per record type, on either platform. Over a server render the evidence is **waits and calls**: run `renderToStream` (or `renderToString`) as the scenario:

```ts
import { captureArtifact, expectNoDiagnostics } from "@solidjs/diagnostics";
import { renderToStream } from "@solidjs/web";

const { artifact } = await captureArtifact(() => renderToStream(() => <App />), {
  scenario: "profile page",
  attribution: false
});

artifact.diagnostics; // server findings too: SSR_RENDER_ERROR_CONTAINED, SERVER_WRITE, HEAD_TAG_INVALID …
artifact.records.boundary; // every <Loading> that waited: durationMs, heldMs, passes, outcome, ownerPath
artifact.records.invocation; // every server-function execution: id, durationMs, outcome, boundary
artifact.records.frame; // every frame stream produced (side: "server"): id, shellMs, durationMs, outcome, the chunk census
```

`boundary` is one row per `<Loading>` boundary that **waited** (a boundary that rendered on its first pass has nothing to attribute): how long it held its content up (`durationMs`), how long finished content then sat behind `<Reveal>` siblings (`heldMs`), how many render passes it took (`passes` — `2` is one round of async, more is a sequential chain) and how it ended (`outcome`: settled, the `renderToString` fallback, a client-only handoff, an error). `invocation` is one row per server-function execution; a direct call made during a boundary's pass carries that boundary's `id` in `boundary`, so a boundary's wait reads as the calls it consisted of. `frame` is one row per frame stream a server component rendered to (`renderServerComponent`, or a server-function response through `frameTransformResult`): time to the shell (`shellMs`) and to `complete` (`durationMs`), how it ended, and a census of what the stream carried (`fragments`, `slots`, `regions`, `errors`); a server-function response that is a frame stream has an invocation row and a frame row with the same `id`. The runtime derives two dev checks from the same facts — `ASYNC_WATERFALL` (server) for a sequential chain and `SSR_CLIENT_CONTENT_MASKED` for client-only content that surfaced only after a wait — so `expectNoDiagnostics` catches them without reading the tables.

In the browser (the in-process capture in a jsdom test, or the bridge under Playwright) the same tables hold the page's **requests**: `artifact.records.call` is one row per server-function call the client made — `id`, `method`, `durationMs` (the whole wait the caller saw), `outcome`, `status` — and `artifact.records.frame` rows with `side: "client"` are the frame streams it applied (`address` is the local boundary the stream was remapped onto; `outcome` adds `truncated` for a body that ended early). A `call` and the server's `invocation` of the same `id` differ by the wire; a `frame` seen from both sides joins by `id` and `version`. The tables are always present; one is empty when nothing of its kind happened. JSONL egress adds one line per record, `type` naming its table.

## Assertions and budgets

Assertion helpers take an artifact and throw `DiagnosticsAssertionError` with an explanatory message:

```ts
import {
  expectNoDiagnostics, // no anti-pattern events (allow list supported)
  expectDiagnostic, // a specific code was (or was expected to be) emitted
  expectRerunBudget, // no more than N re-runs, filterable by scope name
  expectNoWaste, // no re-runs whose recompute produced an unchanged value
  expectNoSilentHolds, // every hold was acknowledged on screen (optional tolerance in ms)
  expectHoldBudget // no hold, acknowledged or not, outlasted N ms
} from "@solidjs/diagnostics";

expectNoDiagnostics(artifact);
expectRerunBudget(artifact, 2, { scope: "doubled" });
expectNoWaste(artifact);
expectNoSilentHolds(artifact);
```

`expectNoSilentHolds` is the responsiveness gate: a hold with no `isPending()`/`latest()` reader, no optimistic value, no `affects()` mark, and nothing painted while it lasted is time the user's input was dead. Its failure names the interaction, the held write, and the blocker; the repair is always to add feedback, never to remove the hold.

Budgets make the same limits declarative and checked-in. A `ScenarioBudget` bounds diagnostics, re-runs (total or per-scope), waste, and holds for a named scenario; `assertBudgetFile` validates a whole file of them:

```json
{
  "formatVersion": 1,
  "scenarios": {
    "counter-update": {
      "allow": [],
      "maxReruns": 2,
      "maxWastedRuns": 0,
      "scopes": { "doubled": 1 },
      "maxSilentHoldMs": 0,
      "maxHoldMs": 500
    }
  }
}
```

## Vitest matchers

Importing `@solidjs/diagnostics/vitest` (e.g. from a `setupFiles` entry) registers matchers that wrap the helpers:

```ts
expect(artifact).toHaveNoDiagnostics();
expect(artifact).toHaveDiagnostic("STRICT_READ_UNTRACKED");
expect(artifact).toStayWithinRerunBudget(2, { scope: "doubled" });
expect(artifact).toHaveNoWaste();
expect(artifact).toHaveNoSilentHolds();
expect(artifact).toStayWithinHoldBudget(500);
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

The bridge also answers live queries against an open session without closing it — `whyDidRun(name)` returns the recorded re-runs of one scope, `costs()` the running cost tables, `holds()` the holds so far, and `feedback()` the ranked feedback tables.

## Dev-server endpoint

`@solidjs/vite-plugin` can inject the bridge and expose capture control over HTTP at `/__solid/diagnostics` (its `diagnostics` option), letting out-of-process tools — including agents — begin/end captures and run live queries against a running dev server. `@solidjs/diagnostics/protocol` publishes the wire types for that endpoint; the plugin re-declares the literals against these types so the two release independently without drifting.

## Skills

The package ships machine-readable guides under `skills/` (npm-installed alongside the code, so they version with the API):

- `skills/agent-loops/SKILL.md` — how an agent runs the generation, acceptance, and attribution loops against artifacts and the dev-server endpoint.
- `solid-js/skills/reactivity-diagnostics/SKILL.md` (in the `solid-js` package) — the repair guide mapping every diagnostic code to its prescribed fix.
