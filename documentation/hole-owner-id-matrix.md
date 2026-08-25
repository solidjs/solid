# Hydration ID Allocation Matrix (Server Hole Owners design)

Phase 0 deliverable for the SSR id redesign (#2801 bug 2). Enumerates every
compiled construct that consumes hydration ids, when it consumes them, per
generator, on current `main` — and what changes under the hole-owner design.

Id sources: every id comes from `getNextChildId(owner)` walking up transparent
owners to the nearest id-carrying owner (`solid-signals/src/core/owner.ts#childId`).
Element `_hk` keys use the same counters via `sharedConfig.getNextContextId()`
(client `hydration.ts`, server `shared.ts`) — element keys and owner ids share
one namespace.

## Current state (verified against fixtures + runtime source)

| Construct | Client (dom generate) | Server (ssr generate) | Allocation time C / S | Aligned? |
|---|---|---|---|---|
| Hydratable element (template root) | `getNextElement` → registry claim by key | `ssrHydrationKey()` → parent counter | registration / registration | yes |
| Elements inside one template | single root `_hk`, walked structurally | single `_hk` per `ssr()` call | — | yes |
| Text-only child hole (`{state.name}`) | `insert(el, thunk)` → transparent effect, allocates nothing | `_v$ = () => escape(...)`, evaluated in `ssr()`, allocates nothing | n/a | yes (0 ids both sides) |
| Id-allocating child hole (`{cond ? <A/> : <B/>}`, `{props.children}`, `{render()}`) | transparent insert effect → content allocates from **parent counter at first compute** | bare thunk → content allocates from **parent counter at evaluation/retry time** | sync source order / **eval order, shifts on deferral** | **NO — the bug** |
| Condition memo, statement form (element child) | `var _c$ = _$memo(...)` in IIFE at template setup → parent slot | same shape, evaluated during ssr-arg evaluation → parent slot | registration / registration | yes |
| Condition memo, inline form (component/fragment child, nested branch) | `_$memo(...)()` inside accessor body → owner active at read | same | read time / read time | yes, becomes hole-owner-scoped on both sides after change |
| Fragment dynamic entry | `_$memo(() => ...)` → **own owner, one parent slot** | `_$memo(() => escape(...))` → same | registration / registration | yes — **existing precedent for hole owners** |
| Component (`createComponent`) | direct call, dev wrapper transparent | direct call | registration / registration | yes (id-parity.spec.ts) |
| Component children/prop getters | evaluated at read under reader's owner | same | read / read | yes; symmetric after change |
| Attribute holes (incl. grouped/textContent closures) | transparent effects, allocate nothing | `ssrGroup`/closures, allocate nothing | n/a | yes (add dev guard) |
| Spread element children | runtime `insert(node, () => props.children)` — transparent | `ssrElement` evaluates `children()` inline; defers as whole element | setup / registration | yes — stays unowned both sides; deferral granularity is the element |
| `lazy()` | client memo owner | server memo owner (server/component.ts) | registration / registration | yes |
| mapArray/Repeat rows | real row owners | **row-owner elision, synthesized id prefixes** (server/signals.ts ~1395) | — | yes — perf optimization, DO NOT touch |
| Inner unwrapping insert effect (accessor value is itself a function) | nested effect (client.js:347) — transparent | no analog — `resolveSSRNode` unwraps in place | n/a | yes — MUST stay transparent (depth invariant) |

## The defect

For id-allocating child holes, both generators treat content as transparent:
content ids come from the shared parent counter at whenever-content-evaluates.
Client evaluation is synchronous in source order; server holes defer on
`NotReadyError` and retry after eager siblings advanced the counter
(`buildAsyncWrap` recaptures the owner but not the counter position).
`orderedInsert` (ssr/element.ts ~808–847) thunk-wraps eager siblings *after* a
deferred hole to partially restore order — it cannot fix a deferred hole whose
own content count is unknown (content may consume multiple parent slots, so
siblings cannot know their offset).

## The change (as implemented)

Give exactly the id-allocating *deferred* child holes their own id scope on
both sides, with the slot reserved at registration (one parent slot each;
content nests under it):

- Predicates: `canChildSlotAllocateIds` (shared in
  `babel-plugin/src/shared/utils.ts`) + the transform's own `dynamic`
  flag, used identically by **both** generates so marking cannot desync.
  (An earlier `isDeferredChildSlotExpression` predicate keyed off the
  *transformed* expression shape and desynced: the dom generate simplifies
  `{sig()}` to the bare getter `sig`, which the predicate didn't count as
  deferred while the ssr side's arrow was — every sibling id after such a
  hole shifted. Caught by the streaming rendering example; the dom generate
  now re-wraps bare getters as `() => sig()` before tagging with `scope()`.)
- **Compiler**: both generates wrap qualifying hole expressions in
  `_$scope(...)` from their respective runtimes. `orderedInsert` machinery
  removed from the ssr generate.
- **Client** (`runtime/src/client.js`): `scope(fn)` tags the accessor
  (`fn.$s`, à la `ssrGroup`'s `.$g`); `insert()` passes `{ scope: true }` to
  its **outer** effect, which `solid-web/src/core.ts#effect` maps to
  `transparent: false`. Owner + id materialize at effect creation
  (registration). CSR (no id context) → no behavioral cost.
- **Server** (`solid/src/server/signals.ts#ssrScope`, re-exported through
  rxcore as `scope`): a **virtual scope**, following mapArray's row-owner
  elision — no owner object. `nextChildIdFor(parent)` reserves the slot at
  wrapper creation (ssr-arg evaluation = registration); every evaluation
  attempt swaps `parent.id = scopeId` / `parent._childCount = 0` around the
  sync eval and restores after. Retries are deterministic because the swap
  sets absolute values captured at registration. The wrapper also unwraps
  function chains in-scope (mirror of the client's transparent inner effect).
  A real per-hole owner was benched first: −8-11% on the search-results SSR
  bench; the virtual swap is ~−2-4% (the residual is the id-slot reservation
  itself, which is the design).
- Fragment entries, statement-form condition memos, components, attributes,
  spread children: **unchanged** — already symmetric per the matrix. The
  Show/Switch/mapArray/repeat server-side slot compensations
  (`consumeClientComputedSlot`, manual `getNextChildId` bumps) also stand.
- Inner unwrapping insert effect stays transparent — one scope level per hole
  regardless of function-unwrap depth.

Consequences: hole content ids/keys gain one level (`t30` vs `t3`); serialized
`_$HY.r` keys shift identically on both sides; deferral can no longer shift
sibling ids because a hole's counter is its own.

## Risks / follow-ups

- Runtime-internal `insert` callers outside the compiler (Portal, Dynamic,
  `@solidjs/h`, `solid-html`) receive no marker → stay transparent, matching
  their unwrapped server counterparts.
- Arbitrary getters that lazily construct JSX are invisible to the predicate —
  same envelope as the previous `orderedInsert` approximation.
- Virtual scope means failed-attempt children attach to the (parent) owner and
  are not disposed per retry — identical leak envelope to pre-change behavior;
  ids stay deterministic because each attempt re-runs with the same
  `(scopeId, 0)` swap. Boundary retries still dispose the whole boundary
  subtree.
- `setContext` inside a hole eval mutates the parent owner's context (no owner
  isolation server-side) — pre-existing asymmetry vs the client effect owner,
  unchanged by this design.
- Array holes whose *items* are functions resolve outside the swap
  (`resolveSSRNode` walks them later) — same envelope as before; the common
  memo/component thunk chains are covered by the in-scope unwrap loop.
