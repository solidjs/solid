# Server-component lifecycle matrix

Systematic coverage of the server-component lifecycle space: mount kinds ×
response lifecycle × slot occurrence behavior × arg tiers × client state
survival × cleanup/disposal × loading/reveal gating. Each cell is a focused
test named for its matrix coordinates; cells that FAIL against the current
runtime are kept as `test.fails` with a `// GAP:` comment — those markers are
the point of the suite.

Harness: `harness.ts` — the `frames-client.spec.tsx` vocabulary
(`installServerComponents` + hand-framed frame-stream Responses behind a
stubbed fetch, so the real server-function stub → transport → component
pipeline is under test), plus a held-open response for chunk-by-chunk
streaming and the real JSON codec (`createJSONSerializer` →
`createJSONDataTable`) for `{$ref}` args.

Status legend: **pass** · **GAP** (`test.fails`, expected behavior not met) ·
**n/a** (structurally impossible — reason given) · **shared** (the code path
is mount-kind-independent; enumerated once where it is richest) · **existing**
(already pinned by a pre-matrix spec; not duplicated).

## Mount kind × response lifecycle

| Cell | Spec / test | Status |
| --- | --- | --- |
| call-driven / single response (start → data → slot → html → complete) | `call-driven-lifecycle` › `call-driven/single-response` | pass |
| call-driven / second response, same version (morph) | `call-driven-lifecycle` › `call-driven/second-response-same-version` | pass — host-driven; the real transport client-stamps a fresh version per response, so a same-version second *response* is unreachable through fetch by construction |
| call-driven / second response, newer version (refetch morph; content + slot records survive, per-response seg/error state clears) | `call-driven-lifecycle` › `call-driven/second-response-newer-version` | pass |
| call-driven / error record before any html | `call-driven-lifecycle` › `call-driven/error-record` (before-html) | pass — surfaces via `frame.error`; boundary mounts empty (see the shell-gate GAP for what the user sees) |
| call-driven / error record after html | `call-driven-lifecycle` › `call-driven/error-record` (after-html) | pass — content stays, error recorded, no teardown |
| call-driven / error then recovery (newer version clears `:error`) | `call-driven-lifecycle` › `call-driven/error-record` (error-then-recovery) | pass |
| call-driven / truncated stream (clean close, no complete) | `call-driven-lifecycle` › `call-driven/truncated-stream` | pass — content stays, no `:complete`, no error, boundary refetchable |
| call-driven / aborted stream (connection error mid-body) | `call-driven-lifecycle` › `call-driven/truncated-stream` (aborted) | pass — transport applies a synthetic error record |
| t=0 adoption / single "response" (the page IS the record) | `document-adoption` › `t=0/adopt-basics` | pass — zero network, record args, element adopted in place |
| t=0 adoption / later stream morphs adopted content | `document-adoption` › `t=0/post-adoption-stream` | pass |
| t=0 adoption / start–complete–truncation cells | — | n/a — adoption does not ride a chunk stream; post-adoption streams take the same `FrameImpl.apply` path pinned under call-driven |
| remount / response lifecycle cells | — | shared — a remounted frame consumes streams through the same store/apply path; remount-specific behavior is pinned below |
| placeholder / fill by a later stream | `placeholder-mount` › `placeholder/fill-by-later-stream` | pass — empty frame under the argless address, filled, then morphed by v2 |
| placeholder / error, fragment, truncation cells | — | shared — identical `FrameImpl` paths as call-driven (the mount kind changes only how the frame acquires its id) |
| placeholder / boundary that may still arrive from the document | — | existing — `frames-late-boundary-client.spec.tsx` (wait for the swap; held fragment after hydration done; give up when reveals exhaust) |

## Slot occurrence behavior

| Cell | Spec / test | Status |
| --- | --- | --- |
| direct-insert position (JSX children); prop w/o server position never invoked; record w/o client fill stays empty | `call-driven-slots` › `call-driven/slot/direct-insert` | pass |
| render-prop call, static scalar args (invoked once) | `call-driven-slots` › `call-driven/slot/static-scalar-args` | pass |
| args changed across responses — live-props path (no re-call; state, node identity, effects) | `call-driven-slots` › `call-driven/slot/args-change-live-props` | pass |
| args changed across responses — re-call path | `call-driven-slots` › `raw-frame/re-call-path` | pass — via a raw `createFrameElement`; unreachable through `dynamic()`: solid-web's `slotsFor` registers `ctx.onUpdate` for every invoked occurrence, so the frame never re-calls there |
| `$key`ed occurrences across reorders (state follows key) | `call-driven-slots` › `call-driven/slot/keyed-reorder` | pass — live range relocates with its interior and signal state |
| occurrence removed in a later response — DOM unmount | `call-driven-slots` › `call-driven/slot/occurrence-removed` (state reset half) | pass |
| occurrence removed — fill's `onCleanup` runs at unmount | `call-driven-slots` › `call-driven/slot/occurrence-removed` (cleanup half) | **GAP** — solid `onCleanup` in a fill registers on the BOUNDARY owner; occurrence unmount runs only frame-level ctx cleanups, so consumer cleanup fires at boundary dispose, not occurrence unmount |
| occurrence re-introduced after removal (fresh invocation, state reset) | `call-driven-slots` › `call-driven/slot/occurrence-removed` | pass |
| re-sent identical record (dedupe: no re-call, no state loss) | `call-driven-slots` › `call-driven/slot/re-sent-identical-record` | pass |
| adopted occurrence: identical re-send dedupes; changed record updates live | `document-adoption` › `t=0/adopted-occurrence-records` | pass |
| args-change handoff at a LIVE site (address switch + changed slot args) | — | existing — `frames-client.spec.tsx` ("notes-search shape") |

## Arg tiers

| Cell | Spec / test | Status |
| --- | --- | --- |
| scalars pass through as literals | `call-driven-args` › `call-driven/args/scalars` | pass |
| `{$ref}` object args resolve via the streamed data table (rich values incl. Date) | `call-driven-args` › `call-driven/args/data-refs` | pass |
| `{$ref}` re-sent, decodes EQUAL → adopted silently (no re-call, no props churn) | `call-driven-args` › `call-driven/args/data-refs` (same value) | pass |
| `{$ref}` re-sent, decodes DIFFERENT → live-props update | `call-driven-args` › `call-driven/args/data-refs` (different value) | pass |
| `{$frame}` region: streams into the wrapper; interior survives root morphs; REBINDS on wire-name change (new stream reaches the same element) | `call-driven-args` › `call-driven/args/regions` | pass |
| promise arg: read suspends on the fill's own `<Loading>`, settles on the patch record | `call-driven-args` › `call-driven/args/async-values` (promise) | pass |
| async-iterable arg: read updates per yield; last value holds between yields | `call-driven-args` › `call-driven/args/async-values` (iterable) | pass |
| async-occluded region records at adoption | — | existing — `frames-occlusion-client.spec.tsx` (sync + promise-valued `sc:region:` records) |

## Client state survival / reset

| Cell | Spec / test | Status |
| --- | --- | --- |
| signal survives root morph (same + newer version) | `call-driven-lifecycle` (morph cells) + `call-driven-slots` (dedupe/keyed cells) | pass |
| signal survives arg updates via live props | `call-driven-slots` › `args-change-live-props`; `call-driven-args` › ref-changed | pass |
| signal survives region rebinds | `call-driven-args` › `call-driven/args/regions` (occurrence not re-called across the rename) | pass |
| signal survives version bumps | `call-driven-slots` › `re-sent-identical-record`, `keyed-reorder`; `placeholder-mount` v2 morph | pass |
| state RESETS on occurrence unmount (re-introduction re-invokes fresh) | `call-driven-slots` › `occurrence-removed` | pass |
| state RESETS on re-call (non-live path) | `call-driven-slots` › `raw-frame/re-call-path` | pass (raw frame; see re-call n/a note above) |
| state RESETS on boundary remount (away/back) | `remount` › `remount/same-args` | pass |
| adopted fill's state survives post-adoption morph | `document-adoption` › `t=0/post-adoption-stream` | pass |

## Cleanup / disposal

| Cell | Spec / test | Status |
| --- | --- | --- |
| fill `onCleanup` fires on frame/boundary dispose, exactly once | `call-driven-slots` › `call-driven/cleanup-disposal` | pass |
| fill `onCleanup` fires on occurrence unmount | `call-driven-slots` › `occurrence-removed` | **GAP** (see above) |
| no double-dispose (second owner disposal is a no-op; ctx cleanups don't re-fire at frame dispose after occurrence unmount) | `call-driven-slots` › `cleanup-disposal` + `raw-frame/re-call-path` (ctx.onCleanup) | pass |
| a disposed frame ignores late chunks (store warms; no DOM writes, no crash) | `call-driven-slots` › `cleanup-disposal` (late chunks) | pass |

## Loading / reveal gating

| Cell | Spec / test | Status |
| --- | --- | --- |
| fragment + reveal sequences reveal when ready, order-independently (reveal-before-content waits; independent segments reveal as their pairs complete) | `call-driven-lifecycle` › `call-driven/fragment-reveal-gating` | pass |
| fallback reveal materializes the placeholder template for a late fragment; the real reveal swaps it out | `call-driven-lifecycle` › `fragment-reveal-gating` (fallback) | pass |
| shell gate: fresh call-driven mount's covering `<Loading>` holds until first content applies | `call-driven-lifecycle` › `call-driven/shell-gate` | **GAP** — the boundary releases at response HEAD (when the transport resolves the call with its binding); between head and the first html record the user sees an empty `<dx-frame>` (the empty-frame flash) |
| shell gate releases on an error record (no eternal fallback) | `call-driven-lifecycle` › `call-driven/shell-gate` (error) | pass — note it passes *because* nothing gates today; if the gate above is added, this cell keeps it honest about the error path |
| t=0 adoption × shell gate | — | n/a — adopted content is already on screen at mount; no covering fallback ever shows |
| deferred segment reveals covering an unboundaried async client fill | — | existing — `frames-client.spec.tsx` (reveal seam reconstructs a client `<Loading>`) |

## Not constructible in this config

- **Compiled-JSX claim-in-place at adoption**: this vitest config doesn't
  compile hydratable JSX (no `_hk` keys), so `claimRender`'s registry path
  can't engage — a JSX fill re-renders over the adopted interior. The
  frame-level claim contract (callback answers `undefined` → interior
  untouched, morph-protected) is pinned in `document-adoption` ›
  `t=0/raw-frame-claim`; the compiled halves live in `test/hydration/` and
  the dom-expressions runtime suites.
- **Same-version second response through the real transport**: the client
  stamps versions (one bump per response), so equal-version writes can only
  be produced host-side; pinned at that level.
- **Re-call path through `dynamic()`**: solid-web registers live props for
  every invoked occurrence, making the frame's re-call branch unreachable
  from the public surface; pinned with a consumer-constructed raw frame.

## GAP summary

1. **Shell gate / empty-frame flash** (`call-driven-lifecycle.spec.tsx`):
   a fresh call-driven mount's covering `<Loading>` releases when the call
   resolves (response head), not when the frame first has content — a slow
   body shows an empty boundary instead of the fallback. Expected: hold
   until the first html record applies, releasing on an error record too.
2. **Occurrence-unmount cleanup** (`call-driven-slots.spec.tsx`): `onCleanup`
   inside a slot fill does not run when a later response drops the
   occurrence — fills' reactive scopes belong to the boundary owner and only
   dispose with the boundary. Expected: occurrence unmount disposes the
   fill's scope (its `onCleanup` runs there), with no double-fire at
   boundary dispose.
