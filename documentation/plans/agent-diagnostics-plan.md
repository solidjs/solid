# Agent Diagnostics Plan — `@solidjs/diagnostics`

_Drafted 2026-08-24. Status: P0–P1 landed (`packages/diagnostics`); P2 core
(vite-plugin `diagnostics` option + `/__solid/diagnostics` endpoint) landed in
the plugin repo; P2 MCP bin and P3+ open. Owner: Ryan._

## Objective

Make Solid's dev-mode diagnostic and attribution channels consumable by AI agents,
so that agent-driven work (ports, refactors, generation) can self-verify against
the reactive graph instead of requiring human code review. First real consumer:
an external port slice (tracked privately until public).

The engine already exists (`@solidjs/signals` — `core/dev.ts`, `core/attribution.ts`):
structured `DiagnosticEvent`s with codes/severity/node identity, `RerunEvent`
cause chains with waste accounting (`changed: false`), graph traversal
(`getSources`/`getObservers`/`getChildren`), and perf pathology warnings whose
message text prescribes the fix. What is missing is **egress** (agents read
artifacts and query endpoints, not in-page subscriptions), **assertions**
(budgets as machine-checkable definitions of done), and **invocation knowledge**
(shipped skills so agents know the channel exists).

Design principle (from `attribution.ts`): _one mechanism, N front-ends_ — the
same hook substrate feeds console logging, devtools GUI, and the agent surface.
Do not fork the mechanism.

## Non-goals

- **No vendor coupling.** Event/wire formats are vendor-neutral (OTel-shaped where
  spans make sense). Observability-vendor consumption is a separate track and must
  not appear in this package, its skills, or its docs.
- **No devtools GUI work.** The community devtools ride the same protocol; separate repo.
- **No spec/RFC-first.** Contracts are extracted from working software after the
  first consumer (the port slice) has used them. Same ordering as everything else.

## Package layout

| Piece                                             | Home                                                                                     | Rationale                                                                                                                     |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Engine (capture, attribution, codes, traversal)   | `@solidjs/signals` (exists)                                                              | Hooks core internals; `__DEV__`-gated                                                                                         |
| Fixture, serializers, assertions, MCP bin, skills | **`packages/solid-diagnostics`** → `@solidjs/diagnostics` (new, in monorepo)             | Consumes the unstable DEV surface → lockstep versioning with the fixed group; CI is the contract test                         |
| Dev-server bridge + pull endpoint                 | `vite-plugin-solid` (separate repo), new `diagnostics` option                            | Injected client module + WS collector + `/__solid/diagnostics`; consumes published protocol types from `@solidjs/diagnostics` |
| Skills                                            | Inside each npm package (`solid-js/skills/`, `@solidjs/diagnostics/skills/`) + installer | Skills must version with the API (lockfile-pinned). TanStack/Electric precedent                                               |

**In-monorepo vs external:** in, for the entire 2.0 beta. Extraction triggers:
(a) DEV event surface declared stable for external tools, or (b) non-Solid
consumers of the protocol appear. What extracts then is the protocol/types
package; the Solid fixture stays home.

**Changesets:** every commit touching `packages/solid-diagnostics/src/` needs one,
same as the rest of the fixed group.

## Phases

### P0 — Harness core (days)

- `withDiagnostics(scenario)` fixture: wraps a scenario in
  `DEV.diagnostics.capture()` + attribution enable; emits a JSONL artifact
  (diagnostics + rerun events + costs summary).
- Assertion helpers: `expectNoDiagnostics(opts)`, `expectRunBudget(label, { maxRuns, maxWastedMs, maxDeps })`, `expectNoWaste()`.
- Vitest adapter.
- Skills v1:
  - `solid-js/skills/reactivity-diagnostics/SKILL.md` — the diagnostic-code
    catalog as a repair guide (e.g. `STRICT_READ_UNTRACKED` → "you destructured
    props; do X"). Written for an agent mid-task, not a human reading docs.
  - `@solidjs/diagnostics/skills/agent-loops/SKILL.md` — the three loops:
    generation (render → read capture → fix → re-run), acceptance (scenario +
    budget = definition of done), attribution (why-run chains → targeted refactor).
- Acceptance for P0: an agent given only the skill + a seeded broken component
  fixes it using capture output, no human hints.

### P1 — Browser harness

- Playwright adapter: injected client bridge + Node-side collector; same JSONL format.
- Budget config format (per-scenario budgets in a checked-in file, so CI owns them).
- Behavioral-diff harness sketch: DOM-mutation + network trace recording under
  scripted interactions, replayable against a second implementation (needed for
  port equivalence where upstream tests are thin).

### P2 — Live query surface

- `vite-plugin-solid` `diagnostics: true`: inject bridge, WS collector,
  `/__solid/diagnostics` pull endpoint (capture control, `whyDidRun(name)`,
  `graphStats()`, sources/observers queries).
- `solid-diagnostics mcp` bin in `@solidjs/diagnostics`: MCP server fronting the
  vite endpoint. Tools: `captureDuring`, `whyDidRun`, `graphStats`.
- Protocol types published from `@solidjs/diagnostics`; the vite plugin's
  dependency version = which protocol it speaks.

### P3 — First consumer: external port slice

A scoped port of a large external React codebase is the first real consumer of
the harness. Candidate selection, audit findings, and scope are tracked
privately (not in this repo) until there is something public to announce.

- Port loop: agents port per-component; every component lands with a scenario +
  budget (P0 acceptance criteria); reactive-quality gate = zero warn/error
  diagnostics, zero waste runs; correctness gate = behavioral diff vs the
  original (P1 harness).
- General shape: UI layer only; server/contracts of the source app stay
  untouched so attribution is clean. Pre-commit checks (generated-code-filtered
  counts, real test-coverage assessment) live with the private notes.

### P4 — Artifacts & calibration

- Audit one-pager: "what we found before porting" (post generated-code filter).
  This is the coordination-tax scanner's first calibration point: record
  predicted deletion, measure actual after the slice.
- Update the port-candidate matrix with measured values.
- Only after the slice works: extract the acceptance-budget vocabulary into
  whatever public contract it wants to become.

## Risks

- **DEV surface churn breaking consumers silently** — budgets that miscount are
  worse than budgets that crash. Mitigation: diagnostics tests run against core
  in the same CI; treat event-shape changes as contract changes.
- **Skill/version drift** — mitigated by in-package skills; never document the
  channel only on the website.
- **Name coverage** — assertions and why-run chains are only as good as `_name`
  population. Verify compiler emits names/source locations for user nodes; fix
  gaps before P3 (agents can't act on anonymous nodes).
- **Source-app velocity** — port targets in this space move fast. Snapshot
  framing, pinned commit, dated artifacts, honest sunset.

## Open questions

- Package name: `@solidjs/diagnostics` vs `@solidjs/audit` (leaning diagnostics).
- Skills installer shape: `npx solid-skills` vs `create-solid` step vs both.
- Whether the P1 behavioral-diff harness lives in this package or with the port.
- JSONL artifact schema versioning (probably `formatVersion` field from day one).

## Related

- Engine: `packages/signals/src/core/dev.ts`, `core/attribution.ts`
- Port candidate selection and audit findings: tracked privately outside this repo.
