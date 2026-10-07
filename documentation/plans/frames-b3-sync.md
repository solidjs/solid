# B.3 without async — who really pins the attribute runtime on a server-component page (2026-10-07)

Measurement-and-design note for Phase D's **B.3** (frames savings pass §3
row D, §4.1). The async form — `dynamic`'s string-tag branch as a lazy
chunk, `dynamic-static.js` — was rejected on 2026-10-06: _introducing async
into an otherwise sync render path is not acceptable._ This note verifies
the hypothesis offered in its place (the frames client is the page's only
`dynamic` user, so frames invoking the component directly would shed the
branch synchronously), measures what the sync form is worth, and states
what it would take. **No source changes**; every number is an edited dist
copy through `scripts/size`'s own bundler (re-attribution §2.1 / §7
method) on `feat/frames-wire-tier` @ `d9395e398` (PR #3868's head, the
top of the stack; base `next` @ `9d89df731`), built fresh (`turbo --force`).

## 0. The finding

**The hypothesis is false.** The frames client does not import `dynamic`
— it never has. Its only import from `@solidjs/web` is `insert`
(`frames/dist/client.js` line 2); the bind tier's are `assign` and
`runHydrationEvents` (`frames/dist/bind.js` line 2); no frames module
references `dynamic`, `Dynamic`, `spread` or `staticElement`. The
transport resolves a server-function call to a **binding** — a callable
branded `COMPONENT_BINDING: { component, address }` (`frame-transport.ts`,
`bindingFor`) — and leaves the mounting to the application: _"there is
deliberately no server-component API in this module … `dynamic` + server
functions [are] the whole client surface"_ (`frames/src/client.ts` header).

The page's `dynamic` importer is therefore the **application** — on the
`page: base` / `page: live` fixtures, line 16 of `sc-base-app.js`:
`const Story = dynamic(() => getStory())`. That is not a fixture artefact;
it is the documented way to mount a server component (#3848: "`dynamic`'s
factory memo is hoisted and never re-runs for a `reset`, so the mount asks
for itself"). Every server-component page carries `dynamic` because the
author wrote it, and `dynamic` carries the string-tag branch
(`staticElement` → `spread` → the whole attribute runtime) because one
function serves both result kinds and a bundler cannot know which kind a
source will resolve to.

So there is no frames-side change that sheds the branch. The sync form of
B.3 is a question about **`dynamic()`'s own shape** — and `dynamic()`'s
string-tag support is public, documented 2.0 surface, not `<Dynamic>`'s
deprecated remainder (§4).

## 1. Importer table

Top-level reachability over the built flat `web.js` (211 units; acorn
graph, BFS from each root set a scenario's modules import; standalone
minified weights from Rolldown's minifier — relative, not additive).
`.wt-logs/b3-graph.mjs`, output in `b3-graph.txt`.

Roots on `page: base` / `page: live`: the fixture's `hydrate`, `Show`,
`For`, `Loading`, `Errored` (36 units); the fixture's `dynamic` (67
units); the frames client's `insert` (17 units, all shared with the
fixture); the **lazy bind chunk's** `assign` + `runHydrationEvents` (38
units — pulled into the entry, see below). `frames: eager` has
`@solidjs/web` external: it reaches nothing here.

| unit                                                                                        |   min B | `page: base` / `live` reached by                                 | only via `dynamic`'s string tag?                                   |
| ------------------------------------------------------------------------------------------- | ------: | ---------------------------------------------------------------- | ------------------------------------------------------------------ |
| `dynamic`                                                                                   |   1,094 | fixture (`dynamic(() => getStory())`)                            | — (the importer itself)                                            |
| `staticDynamic`, `bindingOf`                                                                |     335 | fixture `dynamic`                                                | no — the component branch                                          |
| `staticElement`                                                                             |     179 | fixture `dynamic` (`case "string"`)                              | **yes**                                                            |
| `createElement`                                                                             |     253 | `staticElement`                                                  | **yes**                                                            |
| `SVGElements`, `MathMLElements`                                                             |   1,059 | `createElement`                                                  | **yes**                                                            |
| `getNextElement`                                                                            |     305 | `staticElement`                                                  | **yes** (compiled templates import it directly on a compiled page) |
| `spread`                                                                                    |   1,024 | `staticElement`                                                  | **yes**                                                            |
| `collectProps` (+ `collectSources`, `collectTable`, `entry*`, `resolveSource`, `pushEntry`) | ≈ 1,300 | `spread`                                                         | **yes**                                                            |
| `assign`                                                                                    |     283 | `spread` **and** the bind chunk                                  | no                                                                 |
| `assignProp`                                                                                |     921 | `assign`                                                         | no                                                                 |
| `className`, `classListToObject`, `flattenClassList`                                        |   1,206 | `assignProp`                                                     | no                                                                 |
| `style`                                                                                     |     454 | `assignProp`                                                     | no                                                                 |
| `setAttribute`, `setAttributeNS`                                                            |     529 | `assignProp`, `style`                                            | no                                                                 |
| `addEvent`, `delegateEvents`, `DelegatedEvents`                                             |     753 | `assignProp`                                                     | no                                                                 |
| `eventHandler`                                                                              |   1,108 | `hydrate` (via `attachDelegatedEvent`) — on every hydrating page | no                                                                 |
| `runHydrationEvents`                                                                        |     725 | `staticElement` **and** the bind chunk                           | no                                                                 |
| `Namespaces`, `ChildProperties`, `DOMWithState`                                             |     496 | `assignProp`, `createElement`                                    | no                                                                 |
| `insert`, `insertExpression`, `reconcileArrays`, …                                          | ≈ 4,000 | fixture, frames client, `assign` (children)                      | no — the page floor                                                |
| `Dynamic`                                                                                   |      97 | nobody (shaken)                                                  | —                                                                  |
| `setProperty`, `setStyleProperty`, `dynamicProperty`                                        |     438 | nobody (shaken)                                                  | —                                                                  |

Two importers pin the attribute runtime on these pages, and they overlap:

1. **`dynamic`'s string-tag branch** — the only reach to `staticElement`,
   `createElement`, the element sets, `spread` and the prop-collection
   helpers (≈ 4 KB standalone-min that nothing else wants; −3.6 KB
   apportioned in the bundle, §2), and one of two reaches to `assign` and
   everything under it.
2. **The lazy bind chunk** — `bind.js` imports `assign` and
   `runHydrationEvents` from `@solidjs/web`. Rolldown assigns modules to
   chunks whole: the flat `web.js` is in the entry chunk, so every
   statement a lazy chunk needs from it is **retained in the entry and
   exported to the chunk** (the page-base entry exports 76 bindings for
   its seven lazy chunks). `assign` → `assignProp` → `className` / `style`
   / `setAttribute` / `addEvent` / `delegateEvents` (≈ 4.5 KB min) stay on
   the page for the bind tier even with `dynamic` gone — the "imported, not
   carried" accounting of C6's landing (plan §3 row C6: `tier-bind.js`
   landed 1,844 br with `assign` imported). This is what §4.1 meant by
   "B.3's full saving depends on C6 **and `preserveModules`**" — but
   `preserveModules` alone does not do it (the SC audit measured this on
   2026-09-26: a per-module build of `@solidjs/web` yields `client.js` at
   104 KB, "the entire DOM/attribute runtime"): `assign` and `insert` are
   one source module (`packages/web/src/client.ts`), and chunk assignment
   is per module. The enabler is `preserveModules` **plus** a source split
   of `client.ts` along §2's cut.

## 2. Measured

Harness numbers (Rolldown 1.2.11, brotli q11; `.wt-logs/b3-measure.mjs`,
`b3-edit.mjs`, `b3-split.mjs`). Base = the untouched head dists; the three
`FAIL` lines `size.mjs` prints on this machine (`signals: core floor` +11,
`isPending/latest` +23, `app: CSR` +45 over cap) are the known macOS
brotli layout noise `gate.mjs` discounts, present on every head in this
stack. Entry chunk only; lazy chunks reported where they move.

| variant                                                                                                   | frames eager    | page base                     | page live                     | non-SC (5)                                                                                                | `bind.js` (lazy)                    |
| --------------------------------------------------------------------------------------------------------- | --------------- | ----------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| head `d9395e398`                                                                                          | 32,802 / 10,888 | 112,003 / **35,722**          | 123,903 / **39,412**          | —                                                                                                         | 4,781 / 1,834                       |
| **A — frames stops importing `dynamic`**                                                                  | 0 / 0           | 0 / 0                         | 0 / 0                         | 0                                                                                                         | unchanged                           |
| **B — string-tag branch out of `dynamic` / `staticDynamic`** (`notag`; flat `web.js` as shipped)          | 0 / 0           | −7,532 / **−2,150** → 33,572  | −7,533 / **−2,221** → 37,191  | 0 / 0 (all five, to the byte)                                                                             | unchanged                           |
| B + the attribute runtime as its own module (`notag+split`: the `preserveModules` + source-split form)    | 0 / 0           | −11,393 / **−3,375** → 32,347 | −11,394 / **−3,481** → 35,931 | 0 br (compiled ±30–50 br layout; +6 min, the split's import glue — an artefact of splitting a built file) | **8,806 / 3,209 (+4,025 / +1,375)** |
| B + bind external (the ceiling: nothing attribute-shaped left for any importer)                           | 0 / 0           | −12,413 / −3,753 → 31,969     | −12,414 / −3,796 → 35,616     | 0                                                                                                         | (not bundled)                       |
| control: split alone, `dynamic` untouched                                                                 | 0 / 0           | +12 / +81                     | +12 / +10                     | ±                                                                                                         | unchanged                           |
| control: bind external alone, `dynamic` untouched                                                         | 0 / 0           | −47 / +30                     | −47 / +1                      | 0                                                                                                         | —                                   |
| the late-bound seam read side (`sharedConfig.el?.(tag, props)` in place of the static call), flat / split | 0 / 0           | −2,119 / −3,413               | −2,146 / −3,386               | 0                                                                                                         | as B                                |

Reading the table:

- **Variant A is a no-op by construction.** There is no `dynamic` import
  in `frames/dist/*.js` to remove (§0). Measured as the identity.
- **Variant B is the static tree-shake ceiling of the flat dist: −2,150 br
  on page base, −2,221 on live**, 0 everywhere else. `spread`,
  `collectProps` and friends, `staticElement`, `createElement`, the
  element sets and `getNextElement` leave; `assign` and below stay for the
  bind chunk (rendered exports after the cut: `className, delegateEvents,
addEvent, style, assign, setAttribute, Namespaces, DelegatedEvents,
runHydrationEvents, setAttributeNS, ChildProperties`).
- **With the attribute runtime in its own module, B is −3,375 br on page
  base / −3,481 on live**, and `assign`'s subtree moves to the bind chunk
  (+1,375 br lazy, loaded only when a binding slot is read as data). The
  entry keeps `runHydrationEvents` for the chunk (it owns `claimHandlers`,
  module state the template helpers share) and the chunk's import glue —
  the ≈ 380 br between this row and the ceiling. This is the number that
  replaces §4.1's "B.3 −3,692 on `L8`": the `L8` floor had the bind group
  **deleted**, so `assign` had no second importer there.
- **The two controls say the two importers must both go.** Splitting the
  module without cutting `dynamic`'s branch sheds nothing (`dynamic` still
  reaches `staticElement`); taking the bind chunk's pull away without the
  cut sheds nothing either. B.3's saving is contingent on breaking the
  static reach from `dynamic` to `staticElement`, and there is no
  packaging-only route to it.
- The seam variant costs ≈ +30 br over the cut on the read side; its
  install side (the attribute module registering `staticElement` at
  evaluation) is a few dozen bytes on whichever chunk carries it.

### 2.1 Compiled-page check

Small compiled fixtures through the same bundler (`.wt-logs/b3-fixtures/`,
`b3-compiled.mjs`; hydratable, `dev: false`, the production posture):

| fixture                                                                   | stock `web.js`              | with the branch cut | attribute runtime in the entry                                                               |
| ------------------------------------------------------------------------- | --------------------------- | ------------------- | -------------------------------------------------------------------------------------------- |
| (i) templates, a text hole, a delegated click — no dynamic tag, no spread | 44,731 / 15,263             | same                | **none** (`delegateEvents`, `getNextElement`, `runHydrationEvents` only)                     |
| (ii) (i) + one `<Dynamic component={props.as}>`                           | 60,978 / 20,019 (+4,756 br) | 52,698 / 17,391     | `Dynamic, dynamic, spread, assign, className, style, setAttribute, addEvent, SVGElements`    |
| (ii′) (i) + one `dynamic(() => props.as)` (the 2.0 spelling)              | 57,617 / 19,260 (+3,997 br) | 46,193 / 15,690     | as (ii) less `Dynamic` / `omit`                                                              |
| (iii) `<props.as class=…>` — a member-expression tag                      | 40,856 / 14,060             | same                | none — compiles to `createComponent(props.as, …)`; a string `as` is a `TypeError` at runtime |

What the compiler emits for a dynamic tag: `<Dynamic …>` auto-imports
`Dynamic` from `@solidjs/web` (`builtIns`, `babel-plugin/src/config.ts`)
and emits `createComponent(Dynamic, { get component() {…}, … })` —
a **static** import; `dynamic(…)` is an ordinary runtime call the compiler
does not see, and `<Title>` is `createComponent(Title, …)`; a
member-expression tag is a component call with no string support
(`isComponent`: a dot in the tag name). No `import()` on either path (the
one `import(` in every hydrating entry is `_$HY.loading`'s module loader).
So (i) sheds the attribute runtime entirely and (ii)/(ii′) pull exactly
what they use, statically — a page with a dynamic tag of its own pays for
the runtime through its own import, not through `dynamic`'s shape; the
string-tag branch costs that page **3,570 br** (ii′) when nothing else on
it spreads. `app: compiled CSR` / `compiled hydrating` move 0 under B
(their `<button {...rest}>` imports `spread` directly).

## 3. The component branch — what any sync replacement must keep

The brief asked for the sketch of "frames invoking the component directly".
Since frames never goes through `dynamic`, the sketch that matters is the
**component-only consumer** an application would mount a server component
with, and it is `dynamic` less two lines (`web/src/index.ts` 336–508,
minus `case "string"` at 501 and `staticDynamic`'s string arm at 529).
Everything else is load-bearing:

1. **The hoisted factory memo** (`cached`: `lazy: true`, `equals:
sameInstance`), sync-valued by construction — a thenable the source
   returns is boxed (`FLIGHT`) so the factory never goes pending. It runs
   once per source change, never for a `reset`: #3848's re-ask depends on
   this (the frames node re-reads `host.landing(address)` and opens the
   next flight itself; A7's outward error face). `callFor` and the `reset`
   pins assume the factory holds.
2. **The per-instance value memo** — unboxes; a thenable becomes the
   ordinary async memo the boundary waits on; under hydration it is the
   node the server's record is keyed to and **adopts** it (no pending beat
   for a hydrating `<Loading>`, #3666), with the `latest` token pinning a
   late resolution to the newest compute, and the `untrack(cached)` warm-up
   under `sharedConfig.hydrating` so the tracer's mocked globals never run
   the factory's first compute.
3. **The three-memo owner shape**, identical to `index.server.ts`'s
   `dynamic` (factory / value / render) so hydration ids agree — a
   replacement with a different node count breaks every adopted-face pin.
4. **The render memo**: for a binding, a per-site
   `createSignal(deliveredAddress ??= binding.address, { ownedWrite: true })`
   added to `sites` and removed on cleanup, then
   `untrack(() => binding.component(props, address))`; for a plain
   component `untrack(() => component(props))`. The `untrack` is the
   component contract (`createComponent`'s), and the live address accessor
   is the transport's second-argument convention (`frame-transport.ts`
   §"The address reaches the mount as a second argument").
5. **Kept-resolution delivery** (`resolveBinding`, `sameInstance`,
   `deliveredAddress`): a source switching calls of the same function
   delivers the new address into the mounted instance instead of
   remounting; a remount after a delivery initialises from the latest
   delivered address, not the kept binding's frozen one. This is C16's
   component identity and the `c17-gate-bound-address` rule.
6. **`static: true`** (`staticDynamic`): one untracked resolution, no
   memos, the owner-free path the server's static arm mirrors.

Pins that exercise this branch and would flip on any divergence:
`test/lifecycle-matrix/*` (call-driven args / lifecycle / slots,
container args, document adoption, document live holes, placeholder
mount, remount), `test/frames-errored-reset-refetch.spec.tsx` (nine arms),
`test/frames-dynamic-contract.spec.tsx`,
`test/consistency/c16-reference-identity.spec.tsx`,
`test/consistency/c17-gate-bound-address.spec.tsx`,
`test/hydration/dynamic-async-loading-3666.spec.tsx`,
`test/hydration/frames-adopted-error-outward.spec.tsx`, and the harness's
SC arm. None of them is at stake if the component branch is **shared code**
(the same function body behind two entry points); all of them are if a
second consumer is written.

The string-tag branch has its own pins — `dynamic.spec`,
`dynamic-namespace.spec` (xmlns / SVG / MathML creation), `dynamic-static.spec`,
`hydration/dynamic-hydration-events.spec` (the `runHydrationEvents()`
call after a spread-bound element), `dynamic-tag.bench`, and the server
side's `ssr-element-*` / `dynamic-xmlns` — which any option below keeps
green by keeping the branch reachable from wherever tags are rendered.

## 4. `Dynamic`'s deprecation does not retire string tags

`<Dynamic>` is `@deprecated` (`web/src/index.ts` 560–582; `DynamicProps`
too) and the 2.0 docs say so (`documentation/solid-2.0/03-control-flow.md`
§"Dynamic components: the `dynamic` factory") — **in favour of
`dynamic()`**, whose contract explicitly includes tags: _"Given a source
that produces a component (or native tag name)"_; the migration example
is `dynamic(() => multiline() ? RichTextEditor : "input")`; the motivating
case is polymorphic `as` components. `ValidComponent` is
`IntrinsicElement | Component | (string & {})`. The compiler's `builtIns`
still auto-import `Dynamic`. Removing tags from `dynamic()` is therefore a
**contract change to a 2.0 API**, not the cleanup of a deprecated one; the
deprecation moved the tag case _into_ `dynamic()`.

Nothing in `@solidjs/web`'s types, docs or compiler currently says
anything that this note would correct; the only reflection worth
considering is a sentence in `dynamic()`'s JSDoc stating that importing it
retains the element runtime (the size consequence of its shape), so
authors of component-only pages know the trade.

## 5. Options for a sync B.3 — all of them are public-surface decisions

| option                                                                                                                                                                   | what changes                                                                          | page base (flat / split) | public surface                                                                                                                                                                                                     | behaviour                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| **(a) a component-only sibling** — e.g. `dynamic` keeps its full contract; a second export with the component branch only (same code behind both; name the maintainer's) | SC pages mount with the sibling; `dynamic` unchanged                                  | −2,150 / −3,375 br       | **new export** on `@solidjs/web` (or `@solidjs/web/frames`, reversing "no SC API in this module")                                                                                                                  | none for `dynamic` users; SC docs / examples switch                                                |
| **(b) tags out of `dynamic()`**, tags rendered only through `Dynamic` (deprecated) or a new element-only export                                                          | `dynamic` = component branch; `Dynamic` / `dynamicElement` carry `staticElement`      | −2,150 / −3,375 br       | **contract change** on `dynamic()` (`T extends ValidComponent` narrows); a new export if tags are to live somewhere not deprecated                                                                                 | `dynamic(() => "input")` stops rendering — the documented polymorphic case breaks unless rewritten |
| **(c) the late-bound seam** — `dynamic`'s tag branch calls through a slot the attribute module fills at evaluation                                                       | `staticElement` registered by the module that owns `spread`; `dynamic` reads the slot | −2,119 / −3,413 br       | none in names; **behaviour change**: a page whose only element-runtime user is a string-tag `dynamic()` renders nothing (dev error at best) — the attribute module is included only when something else imports it | same break as (b), reached implicitly instead of by signature                                      |
| **(d) B.3 as the plan wrote it** — the branch lazy                                                                                                                       | —                                                                                     | −3,692 (§4.1, on `L8`)   | none                                                                                                                                                                                                               | **rejected 2026-10-06**: async in a sync render path                                               |
| **(e) take nothing**                                                                                                                                                     | —                                                                                     | 0                        | none                                                                                                                                                                                                               | —                                                                                                  |

(c) is (b) in disguise: in a flat dist the registration is a module-level
side effect Rolldown always keeps (so it retains `staticElement` and the
cut is lost — measured: the read side alone is the number above, the
install side cannot be expressed in one file), and with the module split
it is a tree-shaking-dependent behaviour (`dynamic(() => "div")` works iff
some other import happened to retain the attribute module). Not a
primitive the library should ship.

(a) and (b) are the real choice, and both need the maintainer. The byte
value is the same; they differ in who pays: (a) asks server-component
authors to use a different name for the component-only mount and leaves
`dynamic()`'s contract whole; (b) asks every polymorphic-tag author to
move, against the deprecation note that just moved them here. Either way
the **frames surface is untouched** — `installServerComponents`, the
binding shape, the address accessor convention and the transport are
exactly what they are; a component-only consumer is a `@solidjs/web`
(core) decision.

## 6. Recommendation

1. **Record the finding against the plan**: §3 row D's B.3 and §4.1's
   "−3,692 on `L8`" assume an importer that does not exist. The sync value
   of B.3 is **−2,150 br on page base today**, **−3,375 br once the
   attribute runtime is its own module** (which is `preserveModules` plus a
   source split of `web/src/client.ts` along the cut in §2 — the
   `preserveModules` item in row D is under-specified without it), with
   the bind chunk growing +1,375 br lazy. The ceiling is −3,753.
2. **Do not spend a frames step on it.** There is no frames change that
   moves this; Variant A is the identity.
3. **Put option (a) vs (b) to the maintainer as a public-API ruling**,
   with (a) recommended: it is the only form that keeps `dynamic()`'s
   documented contract and the `<Dynamic>` deprecation story intact,
   costs one export, and shares the component branch's code (so §3's
   pins stay as they are). If he prefers no new surface, the honest
   answer is (e): B.3 does not exist in a sync form without an API change.
4. **The corrected Phase D number, from this head.** Page base is 35,722
   br at `d9395e398`. B.3-sync + the module split: **32,347**. Plus E.b+
   (−462, §4.1, unchanged by this note): **≈ 31.9 KB**. The §4.1 end state
   of ≈ 27.4 KB (8.0) was measured on the `Tglue` floor — a deletion
   build whose pre-Phase-D page base works out to ≈ 31.6 KB — not on the
   landed stack, which the tiers C2–C6 and the residue steps R1–R4 have
   brought to 35.7 KB: the ≈ 4.5 KB between 31.9 and 27.4 is ≈ 4.2 KB of
   floor cuts the pass has not taken (R2's carrier stopped at budget, the
   seams' glue, the D remnants) plus B.3's smaller real value (≈ 0.3 KB).
   **From the landed head, Phase D including a sync B.3 does not reach
   30 KB on page base**; without B.3 it is ≈ 35.3 KB. Whatever the
   pending rulings add or remove is additive to these figures; this note
   does not price them.

## 7. Reproducing

All tooling lives outside the tracked tree in the audit workspace's
`.wt-logs/` (none of it is committed):

- `b3-graph.mjs` — the acorn reachability graph over the built `web.js`;
  root sets per scenario; reverse edges; the string-tag branch's exclusive
  set. Output `b3-graph.txt`.
- `b3-edit.mjs <variant> <in> <out>` — `notag` (the two string arms cut),
  `tagseam` (the seam read side); each anchor asserted to match once.
- `b3-split.mjs <web.js> <dist dir>` — `web.core.js` + `web.attr.js`
  along the explicit attribute-module cut (`spread`, the prop-collection
  helpers, `assign` … `addEvent`, the element sets, `staticElement`,
  `createElement`); core re-exports attr's public names; `applyRef`,
  `runHydrationEvents`, `delegateEvents`, the template / hydration
  helpers and `claimHandlers` stay in core.
- `b3-measure.mjs base | <variant>[+split][+bindext] …` — the harness's
  `bundle()` with the entry's export list and `web.js`'s rendered exports;
  edited copies written beside the dist and deleted after. Results
  `b3-base.json`, `b3-notag*.json`, `b3-none-*.json`, `b3-tagseam*.json`,
  `b3-variants*.txt`.
- `b3-compiled.mjs` (+ `b3-fixtures/*.jsx`) — the compiled-page check;
  `B3_WEB=web.notag.js` for the cut. Compiler output in
  `b3-compiled-output.txt`.
