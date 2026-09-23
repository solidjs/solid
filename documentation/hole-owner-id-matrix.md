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
| Primitive child hole (`{a + b}`, `` {`${x}`} ``, `{-n()}`, literals) | `insert(el, thunk)` → transparent effect, allocates nothing | `_v$ = () => escape(...)`, evaluated in `ssr()`, allocates nothing | n/a | yes (0 ids both sides — the value cannot be JSX) |
| Member-read child hole (`{state.name}`, `{props.header}`) | `insert(el, scope(thunk))` → non-transparent effect, reserves one parent slot at registration | `_v$ = scope(() => escape(...))` → virtual `ssrScope` reserves one parent slot at ssr-arg evaluation | registration / registration | yes since #3567 (1 id both sides; the getter may build JSX — before, it was treated as text-only and allocated in walk order on the server) |
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
  Since #3567 the predicate is a denylist: a hole is scoped unless its value
  is provably a primitive (literals, template literals, unary/binary/update
  expressions), so a member-read text hole such as `{state.name}` also
  reserves one slot on both sides — the price of not knowing statically
  which getters build JSX.
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
- Property reads of any name are scoped (#3567): the earlier `props.children`-only
  rule missed every slot prop, object of slots and context getter.
- A bare identifier hole (`{h}`) never classifies as `dynamic`, so the scope
  gate skips it on both sides. Whether that is safe depends on what the
  identifier holds:
  - An already-built JSX value (`const h = props.header; {h}`, or destructured
    props) is passed eagerly on both sides — `insert(el, h)` on the client,
    `escape(h)` evaluated during ssr-arg evaluation on the server — and its
    elements allocated their ids before the template did. Aligned.
  - A **function** (`const renderHead = () => props.header; {renderHead}`) is
    deferred on both sides but not at the same point: the client's `insert`
    sees a function and runs a transparent effect at the statement, while the
    server's `escapeLate` resolves it inside the `ssr()` walk, after every
    scoped sibling has reserved its slot. Followed by a scoped hole it
    misaligns exactly like the pre-#3567 member hole. **Ruled: not scoped.**
    2.0's `JSX.Element` excludes functions, so type-checked code cannot write
    this hole — it is reached only from JavaScript or through a cast — and
    scoping every bare identifier to cover it would put a slot reservation on
    every `{h}` in production for a shape the types already reject. Instead
    the dev builds detect the permutation itself: an unscoped function hole
    that built content on the enclosing owner's counter at a position the
    other side does not share. Both runtimes bracket an unscoped function
    hole's evaluation with the counter's next id
    (`sharedConfig.devPeekNextContextId`, installed under the dev gate on
    both facades). The server (`ssr()`'s function-hole branch) also records
    the position the hole was registered at (`escapeLate`, argument
    evaluation — where the client builds it) and reports when the walk
    evaluated an allocating hole at a different one; the client (`insert`'s
    transparent outer effect while hydrating) always builds in place, so it
    reports when the content it built inside the bracket moved the counter
    and missed a server-rendered key. Either raises
    [`UNSCOPED_HOLE_ALLOCATED_IDS`](solid-2.0/08-dev-diagnostics.md#unscoped_hole_allocated_ids)
    (`warn`, kind `render`, once per site), naming the function and the fix:
    call it at the hole (`{renderHead()}`) or pass the built value. The
    finding is the shift, not the allocation: a function hole with nothing
    scoped after it in its template lands on the same ids on both sides and
    is silent; followed by a scoped hole it is the same gap and is reported.
    (`<Errored>`'s zero-arity `fallback={() => <F />}` thunk — type-reachable,
    `() => X` being assignable to `(err, reset) => X` — used to be handed back
    unresolved and built by the consuming hole, exactly this shape: silent
    with nothing scoped after the boundary, reported otherwise. Ruled to work
    like `<Show>`'s function child: `<Errored>` calls a function-valued
    fallback inside its own scope whatever its arity — the boundary's output
    computed on the client, the mirroring output owner on the server, where
    the `(err, reset) => X` form always ran — so both arities allocate
    identically and nothing reaches the hole. Pinned by
    `errored-thunk-fallback-followed-by-scoped-hole` in the #3567 harness.)
    A scoped hole restores the counter
    (server) or owns its ids (client); a memo or component accessor
    allocates under its own owner; `spread`'s runtime children insert is
    transparent by design on both sides and is excluded. Zero bytes in the
    prod and observe artifacts. Pinned by the `function-identifier` scenario
    in `packages/web/test/harness/slot-hydration-3567.tsx`: the diagnostic
    fires on server render and client hydrate, AND the keys still permute —
    so a change to either half is noticed.
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
