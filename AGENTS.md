# Agent guide — solidjs/solid

This file is the one agent instruction file for the repo (Codex, Cursor, Copilot, Gemini CLI and Claude Code all read a root `AGENTS.md`). Package guides with more detail are in `.cursor/rules/`: read `signals.mdc`, `solid-core.mdc`, `web.mdc` or `testing-patterns.mdc` before changing that package or its tests.

`main` is Solid 2.0. Solid 1.x lives on the `1.x` branch. The `next` branch no longer exists; older docs that say "on `next`" mean what is now `main`.

## Which docs are current

- **Async, pending, optimistic and store semantics:** `packages/signals/docs/RULES-FUNDAMENTALS.md` (`F-<n>`) beats `RULES-DERIVED.md` (`D-<n>`), which beats `SCENARIOS.md` (`S-<n>`). Unresolved disagreements are in `OPEN-QUESTIONS.md`. Before deciding which behavior is right, find the governing rule and cite it. A case that seems to need a new rule goes to the maintainer, not into a quiet amendment.
- **Cite only F-, D- and S- ids** in new code comments, tests, PRs and reviews. `SPEC-ASYNC-SEMANTICS.md` (A/B/C/V ids) is a frozen archive; its banner maps each A-id to the rule that replaced it. `RULES-INDEX.md` is generated (`node packages/signals/scripts/rules-index.mjs`) and resolves every id still cited.
- **User-facing behavior and API:** the docs site (https://docs.solidjs.com), `packages/solid/CHEATSHEET.md` and `documentation/solid-2.0/MIGRATION.md`.
- **Historical, not current behavior:** `documentation/solid-2.0/01`–`12` (the 2.0 RFCs, frozen at the 2.0.0 release), everything under `documentation/archive/` and `packages/signals/docs/archive/`, and `documentation/proposals/` (ideas, none built). Read them only for history or when asked; they name code that has since changed or been removed.
- `documentation/solid-2.0/08-dev-diagnostics.md` is also the source table for `scripts/generate-diagnostics-json.mjs`; keep its table in step with the diagnostic codes.

## Architecture

SolidJS core monorepo — a declarative JavaScript UI library that compiles templates to real DOM nodes with fine-grained reactivity. Version 2.0.

### Monorepo Structure

PNPM workspaces + Turborepo. Changesets versioning: the core runtime (`solid-js`, `@solidjs/signals`, `@solidjs/web`, `@solidjs/universal`, `@solidjs/diagnostics`) is one fixed group and always shares a version; `@solidjs/compiler` and `@solidjs/babel-plugin` are linked (they share a version when both release); `@solidjs/h`, `@solidjs/html` and `@solidjs/element` version on their own.

- **`@solidjs/signals`** (`packages/signals/`): The reactive engine — signals, memos, effects, async, stores, optimistic lanes, scheduler. Internal to this repo; everything else builds on it (see `.cursor/rules/signals.mdc`).
- **`solid-js`** (`packages/solid/`): Core runtime — component model, flow controls, context, hydration. Wraps `@solidjs/signals` with a UI layer.
- **`@solidjs/web`** (`packages/web/`): Web platform runtime — `render`, `hydrate`, SSR methods, `Portal`, `Dynamic`, and the DOM operation runtime. Also hosts the server-function runtime (`server-functions/`), the frames transport (`frames/`), the seroval streaming codec (`serialization/`), and storage helpers (`storage/`), each behind its own export path.
- **`@solidjs/h`** (`packages/h/`): Hyperscript/JSX factory — less-optimal JSX alternative.
- **`@solidjs/element`** (`packages/element/`): Web Components wrapper.
- **`@solidjs/html`** (`packages/html/`): Build-less tagged template literals.
- **`@solidjs/universal`** (`packages/universal/`): Universal runtime for custom renderers.
- **`@solidjs/babel-plugin`** (`packages/babel-plugin/`): Babel plugin for JSX compilation.
- **`@solidjs/compiler`** (`packages/compiler/`): Native (Oxc) JSX compiler.
- **`test-integration`** (`packages/test-integration/`): Integration tests against external repos.

### Dependency Chain

```
@solidjs/signals  (reactive primitives)
       ↓
   solid-js       (component model, flow controls, context, hydration)
       ↓
  @solidjs/web    (DOM rendering, SSR, Portal, Dynamic, DOM ops)
  @solidjs/universal / @solidjs/h / @solidjs/html
```

`solid-js` re-exports all reactivity primitives from `@solidjs/signals` and adds the component/JSX layer on top. `@solidjs/web` provides the platform-specific runtime, including the DOM operation runtime. Compilers live in `@solidjs/compiler` (native) and `@solidjs/babel-plugin`; their validators and codegen must stay in parity (shared test expectations).

### Component Model

Components are plain functions: `(props: P) => JSX.Element`. No classes, no hooks. Component creation is wrapped in `untrack()` to avoid reactive tracking during initialization.

Component types enforce children constraints:
- `Component<P>` — no implicit children
- `VoidComponent<P>` — forbids children
- `ParentComponent<P>` — optional `JSX.Element` children
- `FlowComponent<P, C>` — requires children of type `C`

### Reactivity Integration

All reactivity comes from `@solidjs/signals`:
- `createSignal()` → `[getter, setter]`
- `createMemo()` → derived computation
- `createEffect(compute, effect)` — separate compute and effect phases
- `createStore()` → proxy-based deep reactivity
- `flush()` — updates are batched; must flush to process

### Flow Controls

Built on signals primitives: `For` (mapArray), `Repeat` (repeat), `Show` (createMemo), `Switch/Match` (children + memos), `Errored` (createErrorBoundary), `Loading` (createLoadingBoundary), `Reveal` (createRevealOrder).

All support `keyed` mode (identity comparison) vs non-keyed (truthiness). Function children in `Show`/`Match` receive narrowed accessors with stale-read protection.

### Build-time Constants

`_SOLID_DEV_` is replaced at build time (see rollup configs). Use it for dev-only code to enable tree-shaking in production.

### Commands

- `pnpm install` — install dependencies (pnpm 9.15+ required)
- `pnpm build` — Turborepo build (all packages)
- `pnpm types` — generate TypeScript declarations
- `pnpm test` — run all tests + type tests
- `pnpm coverage` — coverage reports
- `pnpm format` — Prettier formatting (also runs on pre-commit)

### Key External Dependencies

- `seroval` / `seroval-plugins` — serialization for SSR, server functions, and storage

## Engineering Standards

This is a foundational library laying groundwork for the future. "Good enough" is never acceptable.

### Questions are not instructions

When the user's message is a question, an opinion, a reaction, or thinking out loud ("is this right?", "seems complicated", "I wouldn't mind if…", "do you know what that is?"), the deliverable is an answer. Do not edit files, run tests that mutate state, commit, or push in that turn — even if the answer makes the next step obvious. Propose the step and stop.

Act only on an imperative from the user ("do it", "ok", "go", "fix it", "commit"). An "ok" applies to the specific proposal it answers, not to follow-on work discovered afterward.

Commits and pushes always require an explicit ask in the user's latest message. Otherwise stage and report.

### Approach

- **Never take shortcuts.** If a plan calls for a fundamentally different architecture, implement it differently — don't rename the existing one and call it new.
- **Flag deviations immediately.** If you can't implement what was asked, say so and explain what you don't understand. Never silently substitute an easier alternative.
- **Understand before implementing.** If a design or proposal isn't fully clear, ask questions first. Don't start coding until the model is understood.
- **Correctness over speed.** Take the time to get it right. A wrong implementation that passes tests is worse than no implementation.

### Public API changes must be flagged

Any change to the public surface — a new or removed export, prop, option, or parameter; a changed signature, default, or documented behavior of an existing one; a new diagnostic code — must be called out explicitly to the maintainer *before* it is made (or, when discovered mid-task, before it is committed), stated as its own item, not folded into a summary of the fix. This applies to changes made for "parity", "symmetry", or "while I was there" exactly as much as to changes the task asked for; those are the ones most likely to slip through. The same applies to instructions given to subagents: a brief that would add or remove public surface must say so, and the agent must report the surface it touched. The PR body must list every public API change under its own heading.

### Code comments

The rules live in `packages/signals/docs/` (`RULES-FUNDAMENTALS.md`, `RULES-DERIVED.md`, `SCENARIOS.md`), and behavior is pinned by tests. A comment is a third place that can disagree with both, and nothing tests it. So:

- **No narration.** Do not describe what the code does or restate a rule. If a reader needs the behavior spelled out, it belongs in a rule or a test.
- **A short "why" on a non-obvious line only.** One or two lines saying why this line exists, ending with the rule id it serves: `// A guess over a held slot entangles the frames (D-8, D-33).` Cite the rule; do not quote it.
- **Cite the rule that stands.** F/D/S ids over archive ids (A, B, V, mined R-ids). Never a folded, retired, superseded or withdrawn rule: cite the one that replaced it. Mined R-ids carry their namespace (`OL-R5`, never a bare `R5`).
- **No history.** No "before, it…", dates, narrated rulings, fuzzer traces or which PR changed what. That is git's job.
- **An issue number only when no rule covers the line.** It names the regression test that pins the line. A why that can only cite an issue is a missing rule: say so in the PR.
- **Keep:** public API JSDoc (it is user documentation), performance and bundle-size reasons (no rule covers them), and short pointers to where a hook is installed.
- **A comment that disagrees with the code is a finding.** Raise it with the maintainer. Do not change the comment to match the code, or the code to match the comment, without a ruling (on #5008 the comment was right and the code and its pins were wrong).
- **CI.** `packages/signals/scripts/rules-index.mjs --check` (run by the signals `pnpm test`) fails on a citation that resolves to no rule and, for files listed in its `POLICY`, on a citation of a rule that no longer stands, a bare R-id, or a reference to a document the repo does not have. Add a file to `POLICY` when you bring it under this policy. `--comments` prints the census for every file.

### When Comparing Approaches

- Each approach must be architecturally distinct, not a rename of the other.
- Identify the specific structural differences before writing code.
- If two approaches converge to the same implementation, stop and report that — it's a finding, not a failure.

### Changesets

**CRITICAL — NEVER SKIP THIS STEP.** Every commit that changes source files under `packages/` MUST include a changeset. This is a hard requirement, not a suggestion.

**Before running `git commit`**, always:

1. Check if the staged changes touch any files under `packages/*/src/` — if yes, a changeset is required.
2. Create the changeset file (`.changeset/<descriptive-name>.md`).
3. Stage it alongside the code changes.
4. Only then run `git commit`.

Since `pnpm changeset` is interactive and cannot be used from the agent, create the file directly:

```markdown
// .changeset/<descriptive-name>.md
---
"@solidjs/signals": patch
---

Short summary of the change
```

- **Changesets follow semver:** `patch` for fixes, `minor` for features, `major` for breaking changes. (During the 2.0 prereleases every changeset was `patch`; that ended with 2.0.0.)
- List the package(s) that actually changed, by directory. Source under `packages/solid/src/` → `solid-js`; `packages/signals/src/` → `@solidjs/signals`; `packages/web/src/` → `@solidjs/web`; etc. If a single change touches multiple package sources, list each one. (The core runtime packages are one `fixed` group, so a changeset for any of them bumps all five; the compilers are linked; h, html and element bump only when a changeset names them. See `.changeset/config.json`.)
- If a commit only touches examples, tests, or tooling config (not source under `packages/`), no changeset is needed.
- The changeset file name should be descriptive (e.g., `fix-ssr-async-error-handling.md`), not random words.

### Communication

- Be direct about what you don't know or don't understand.
- Never let the user discover a mistake you could have caught — if something seems off, raise it proactively.
- When debugging, reproduce the issue in a test before attempting fixes. Don't spin in circles with speculative changes.

## Agent Voice on GitHub

All conversational RESPONSES an agent posts to GitHub on the maintainer's behalf — comments on existing issues and PRs, review bodies, discussion replies, close/reopen comments — MUST be wrapped in markdown blockquotes (`> ` prefixing every line, including blank lines within the quoted body). This is the maintainer's established convention (used on Discord as well) so readers can tell agent-authored responses from his own, and so responsibility for agent actions (closes, merges, verdicts) is auditable.

Bodies of NEW issues and PRs the agent opens are exempt — authorship is already clearly credited there. This policy is about responses in conversation.

Every blockquoted response MUST end with an attribution line as the last line of the quote, after a blank quoted line:

```markdown
❌ BAD
Confirmed and fixed in fc7e626f — thanks for the reproduction.

✅ GOOD
> Confirmed and fixed in fc7e626f — thanks for the reproduction.
>
> Root cause: derived stores fold drafts on the clone path...
>
> — *Claude via Cursor*
```

Rules of thumb:

- Code blocks inside the comment stay inside the blockquote (prefix the fences too: `> ```ts`).
- The attribution names the actual agent — model and/or product, e.g. `— *Claude via Cursor*` — the same way agents credit themselves on commits and PRs. Keep the `— *<agent>*` shape consistent so readers learn to recognize it.
- Applies to `gh issue comment`, `gh pr comment`, `gh pr review --body`, close/merge `--comment` bodies, and API-posted comment bodies.
- Does NOT apply to commit messages, changesets, PR/issue titles, labels, or code — only conversational bodies.
- If quoting someone else inside an agent comment, use a nested quote (`> >`).
