# Frames client — function-by-function re-attribution under A0 (2026-10-06)

Branch `size/frames-a0-reattribution` off `next` @ `23176235d`. **Nothing here
changes an engine**: this document and nothing else. Companions: the
server-components size audit (`sc-layer-audit.md`, `size/sc-audit` @
`0bb67ff38` — its §2 attribution and Appendix A are the unit list this
document re-classifies), the frames rulings
(`documentation/server-components/frames-rulings.md`, `spec/frames-rulings` @
`757aba41c` — the Principle and the sixteen rulings each marked `Restates:`
or `Frames-specific:`), the principles doc's A0
(`server-components-principles.md` §2, same branch), the consistency
contract (`frames-consistency-contract.md`, merged in #3813, with its
twenty-two `test.fails` under `packages/web/test/consistency/`), and the
signals core's L2 section (`packages/signals/docs/SPEC-ASYNC-SEMANTICS.md`).

The maintainer's question, verbatim: *"in all honesty our frames solution is
huge — almost 3× our original target."* The frames eager-client scenario
ships at **13,770 B brotli / 43,310 B minified** against the principles doc's
§6 budget of ≤ 7,800 B (§6 wrote the budget as min+gzip, ≈ 7.0 KB br; the
3× is read against brotli, and this document reads it the same way). The SC
size audit's best case — packaging plus a scoped rulings pass — floored the
scenario at ≈ 10.5 KB br. **That audit classified before A0**: its
"structural" meant *a frames ruling requires it*. Under A0, a frames ruling
that restates a core rule does not justify frames-side bytes. This document
re-classifies every unit against A0 and measures the floor of "frames that
is only a transport", so the maintainer can decide whether the gap is a
**second-model problem** (fixable by deletion) or a **scope problem** (a
product decision about feature tiers).

_Status: in progress — sections are committed as they land._

---

## 0. The rubric

Every unit of the frames eager-client scenario (and the frames / sf units of
`page: base`) is classified into exactly one of four classes. A unit whose
bytes split across classes is classified by its majority and carries a
residue note; the class totals are given both ways (by whole unit, and with
residue re-attributed).

- **T — transport.** What a frame needs to fetch, decode, morph, claim and
  refetch/switch, using the core for everything async: fetch/request and
  the response → binding resolution; chunk framing and parsing; the eager
  half of the codec seam; morph of foreign markup into a range (A7,
  identity-first); hydration claim of server nodes; address → store write
  (A3); site → bound address pull (A4); references and the flight codec;
  the hydration-key payload. **Keep.**
- **R — restates core.** The frames side implements something the core
  already provides under A0: a second reveal engine where the core has
  landings; a shell gate where `<Loading>` has pending state; a version
  space where a memo has a value; waiters/holds where the hold model has
  `holdNode`/`land`; staging-at-commit where the transaction stages;
  dedupe/tables where supersession already drops the stale answer; error
  state where `<Errored>` exists; its own "done" accounting. For each R unit
  the core primitive it duplicates is named (`file:function` in
  signals/solid/web) and what remains if frames routed through it.
- **F — feature.** A capability above the minimal transport: live/GET
  re-emission (E.a), binding/attribute slots (E.c, Stage 7), container
  traces (N), staging/preview at commit (#3759 — the *capability*; its
  *carrier* is R, see §1.3), document-face duality beyond the t = 0 claim,
  regions/nested frames, asset loading, element claims and the
  `frame:applied` event (the router contract), dev/diagnostics in prod.
- **D — dead/incidental.** Unreachable, duplicated seams (the audit's §4
  list), compat shims.

The method is the SC audit's: a source-map function-size tool over the
scenario's minified entry chunk (rebuilt under `tmp-tools/`, not committed;
§7 reproduces it) charges every mapped byte to the innermost named function
in the dist source; the pieces sum to the chunk exactly. Brotli per class is
measured by removing the class from an edited dist copy where that is
feasible (§2, §3), and estimated at the layer's observed ratio (≈ 0.32 on
the frames scenario) where it is not.

---

## 1. Classification

**Baseline, re-measured on this head** (`scripts/size`, local macOS, Node
26, Rolldown 1.2.11): frames eager **43,310 B min / 13,770 B br** (the
frames client 39,199 + the retained sf slice 3,797 + 314 B of import
statements); page base 145,569 / 44,823 (the frames + sf modules are 51,566
of it — within 11 B of the SC audit's 51,577; the signals/solid changes
since `6f77b1bde` moved the rest). The frames and server-functions sources
are byte-identical to the SC audit's base, so its Appendix A figures hold
to the byte and its unit names are reused here. The tool charges inner
named closures separately (`createServerComponentHandler.handle`,
`slotsFor.get`, `bindDataOccurrence.write`, …): 303 units on the frames
scenario, 0 B unclassified, the pieces summing to the chunk exactly.

Twelve of the R claims below were independently verified against the core
sources (`signals/src/boundaries.ts`, `core/scheduler.ts`, `core/async.ts`,
`core/lanes.ts`, `solid/src/client/hydration.ts`, `web/src/client.ts`,
`web/src/server.ts`) before the classes were fixed; where the verification
narrowed a claim the narrower reading is the one used, and §1.2 says so.

### 1.1 Class totals

Frames eager-client scenario (43,310 B min):

| class | by whole unit | share | residue re-attributed | share | br (measured, §2–§3) |
| --- | --: | --: | --: | --: | --- |
| **T — transport** | 26,879 | 62.1 % | 21,479 | 49.6 % | the floor, §2 |
| **R — restates core** | 5,080 | 11.7 % | 6,655 | 15.4 % | §2 (the L8 step) |
| **F — feature** | 10,615 | 24.5 % | 13,035 | 30.1 % | §3 per tier |
| **D — dead / incidental** | 736 | 1.7 % | 2,141 | 4.9 % | §2 (the L7 step) |

"By whole unit" assigns each function to one class; "residue re-attributed"
moves the bytes a unit carries for another class (the live arms of
`chunkToRecords`, the `_s:` branch of `collectSlots`, the gate half of
`adoptBoundary`, the `#2968` arm of `#syncSlots`, …) to that class. The
second column is the honest one; the first is the one a reader can check
against a function name. Brotli is measured, not estimated, by removing
each class from an edited dist copy (§2, §3); where only an estimate is
possible the frames layer's observed ratio (0.318 on this scenario) is used
and marked.

Page base, frames + sf modules only (51,566 B min; the sf client is whole
here — `dispatchServerFunction`, `createRequest`, `GET`, the encoding
ladder):

| class | by whole unit | residue re-attributed |
| --- | --: | --: |
| T | 34,945 (67.8 %) | 28,756 (55.8 %) |
| R | 5,111 (9.9 %) | 6,686 (13.0 %) |
| F | 10,771 (20.9 %) | 13,191 (25.6 %) |
| D | 739 (1.4 %) | 2,933 (5.7 %) — the extra ≈ 800 is the sf client's: `GET`'s re-implemented proxy ≈ 300, `createRequest`'s and `serializeArguments`' prod message text ≈ 580 |

By group, frames eager, residue re-attributed (min B):

| group | B | what it is |
| --- | --: | --- |
| T.wire | 5,691 | `ChunkReader` ×5, `applyFrames` + `drain`/`end`, the handler's `handle`/`bindingFor`/`componentFor`/`bump`, `stableString`/`hashArguments`/`frameAddress`, `createChunk`, the module scope and the import statements |
| T.morph | 3,891 | `reconcileChildren`, `morphAttributes`, `morphNode`, grafts and range moves, `#applyRoot`, `parseFragment`; **and the segment swap** (`#revealSegment`'s DOM half, `#showFallback`, `findPlaceholder`/`rangeClose`) — see R.reveal below for why the swap is transport |
| T.slots | 3,749 | `#syncSlots`' mount/update/re-call/unmount core, `#invokeSlot`, `#resolveArgs`' ref/literal arms, `slotsFor.get`/`evaluate`/`bind`, `collectSlots`' marker walk, `slotArgsProxy`, `liveSlotProps`, `revealSeam`, `boundaryScope` |
| T.store | 2,834 | `chunkToRecords`' content cases, `createFrameHost`'s `write`/`apply`/`register`/`unregister`/`storeFor`/`get`, `FrameImpl#apply`'s write loop, `#flush`'s root and segment passes, `dispose`, `rebind`'s re-id/re-register, the fields |
| T.doc | 2,381 | `adoptBoundary`'s core, `drainRecords` (the document face's inline-record transport), `installServerComponents`, `documentBoundary`, `findBoundaryElement`/`indexBoundaries`, `installRevealHook`, `awaitBoundary`/`boundaryMayArrive`, `intercept`, `showing` |
| T.decode | 975 | `loadCodec`, `tables`/`ensureTable`/`tableFor`/`beginStream`, `getFrameHost`, `deserializeStream`'s non-live half, `#resolveRef` |
| T.flight | 793 | `applyFlightResponse`'s envelope/region routing, `deliverFlightData`, `hasFlightMetadata` |
| T.refs | 610 | `ServerComponentPlugin`, `flightCodec`, `parseServerComponent`, `asyncArg` |
| T.claim | 225 | what `claimRender` keeps (the owner with `id: prefix`, `claimRoots` for a detached range) |
| **F.bind** | 4,508 | binding/attribute slots (E.c) |
| **F.live** | 3,522 | live/GET re-emission + the document live channel (E.a) |
| **F.assets** | 2,082 | the stylesheet/preload/inline-style mirror |
| **F.regions** | 1,393 | nested frames / `{$frame}` regions |
| **F.trace** | 843 | container traces, eager half (N) |
| **F.claims** | 527 | element claims for the router |
| **F.event** | 160 | `frame:applied` |
| **R.stage** | 2,072 | the staging carrier (#3759) |
| **R.dedupe** | 923 | the two dedupes |
| **R.gate** | 674 | the shell gate ×2 and the re-arm |
| **R.insert** | 621 | the static fill path beside `insert` |
| **R.version** | 504 | the frame's own version space and applied state |
| **R.claim** | 472 | the range-scoped registry beside `gatherHydratable(el, root)` |
| **R.reveal** | 467 | the readiness/retry model beside `$dfd`/`$dfs`/`_$HY.v` |
| **R.drain** | 409 | the `#2968` defer and the per-record drain |
| **R.error** | 156 | the once-per-stream error latch and the stamp fast-adopt |
| **R.claimant** | 153 | `claimRegionFragments` |
| **R.refwait** | 145 | the `{$ref}` wait with no carrier |
| **D** | 2,141 | §1.4 |

### 1.2 R — what each group restates, and what remains

Every R group names the core primitive it duplicates, what the frames side
would keep if it routed through the core, and the verifier's verdict
(**confirmed** / **partial** — the narrower reading is the one the tables
use). Bytes are frames eager, min, residue re-attributed; "remains" is
estimated from comparable glue in the codebase.

| group | B | duplicates (core `file:function`) | remains on the frames side | verdict |
| --- | --: | --- | --- | --- |
| **R.stage** — `stage` (+ `entry.stream/apply/preview/commit`), `named`, `settled`, `latest`, `stagedContent`, `contentAddress`/`CONTENT_TOKEN`, `STAGED_DATA`, `stageTables` ×5, `FrameImpl#preview`, `#regionsChange`, `createFrameHost.preview`, `applyFlightResponse.regionOf` + its staged arm, `followAddress`'s `preview`/`commit` calls | 2,072 | `signals/src/core/scheduler.ts:holdNode` (381), `list` (389), `staleReader` (1021), `land` (976–992, `commitPendingNode`) — L2 ruling 1 (a node is committed or staged for this flush), A29 (a tracked read served a staged value enters that transaction). The follow effect's compute half **already runs in the transaction's pass** (`client.ts:225–236`: `binding()` is written by `dynamic`'s landing and held with it). | Collect the response's chunks until `complete` and land them as **one write** (`stage`'s `chunks`/`committed`/`commit` ≈ 120 B) plus one reactive node per bound address written at the landing (`content = createMemo(() => host.landing(binding()))` ≈ 40–80 B — the **address-source seam**, §5) and a per-response data cell (frames-rulings 1.2, ≈ 140 B). The `preview` half deletes whole: fills' props become readers of the landing node and re-derive in the pass by A29 — `FrameImpl#preview` 505, `#regionsChange` 123, `host.preview` 124, the token machinery ≈ 150, `stageTables` 183. **Net ≈ −1,100 to −1,350** (the verifier's conservative figure, counting the glue heavier, ≈ −700). | **partial** — the buffer is transport, the `preview` half and the token/table machinery are R |
| **R.dedupe** — `argsEquivalent`, the `slot:` arm of `FrameImpl#apply`, `#refArgsUnchanged`, `#slotResolvedRefs`, `#syncSlots`' adopt arm | 923 | A memo's `equals` (default `===`): an equal landing confirms and readers do not re-derive (A18 (a)); L2 ruling 1: a value is its latest landing, never a merge (frames-rulings 1.4, full form). The container-identity rule (`frame-client.ts:1727`) and the async-identity rule (1739) **are** `===`. | Per-prop memos in `slotArgsProxy` (the async branch already mints them, `client.ts:437–448`) ≈ 80 B and a structural `equals` for deserialized plain objects (today's `JSON.stringify`) ≈ 60 B. The re-call-on-args-change path (`#syncSlots` 1437–1450) is already dead for Solid's binding (`#invokeSlot` always registers `onUpdate`). **Net ≈ −750.** | **confirmed** |
| **R.gate** — `boundaryComponent`'s `arm`/`release`/`settle`/`setGate`/`mountGate`/the gate signal/the two memos, the twin in `adoptBoundary` (+ the no-op "pending observer"), `followAddress`'s `rearm` + frameless waiter + `drop` | 674 | `signals/src/boundaries.ts:createBoundary` 580–620 (STATUS_PENDING forwarding; A29's boundary exemption at 607–617); a memo whose compute returns a promise is a flight — `core/async.ts:handleAsync` 327–399, stale flight dropped at `asyncWrite` 445 (`_inFlight !== result`). **The gate is already a core async read** (`client.ts:1072`, `createMemo(() => gatePromise())`); what is duplicated is the hand-rolled promise minting, done twice, derived from the frame's *registration* instead of the *bound address*. | `createMemo(() => (host.firstWrite(address), element))` where `host.firstWrite(address)` returns `undefined` for a warm store and otherwise a promise resolved at the address's first write — the frameless waiter `followAddress` already registers, moved into the host: ≈ 70 B host + ≈ 40 B memo; the adopted face keeps a 40 B observer or returns the memo. **Net ≈ −250 to −300.** Consequence: C17 (c) lands on ruling 1.6 (i) — a per-address promise is a new flight, A's late landing is superseded and never reveals (`waiting → B`). `rebind` stays in the effect half (the 2026-10-04 ruling is untouched). | **confirmed** (the fix is "derive the promise from `binding()`", not "remove a boundary") |
| **R.insert** — `normalizeSlotContent`, `isReactiveContent`, `slotsFor.get.settle`, `FrameImpl##replaceRange`, the returned-`nodes` path through `#syncSlots`/`#invokeSlot`/`#slotNodes` | 621 | `web/src/client.ts:insert` 1405–1424: a non-function value → `normalize` → `insertExpression` **with no render effect** (1418–1424); `insertExpression` 2725–2754 is a claim pass under hydration and a `value === current` no-op at 2755; `reconcileArrays` for arrays; `claimInitial` 1270 respects a provided `initial`. The `slotsFor` comment already says it: "an accessor that yields the claimed nodes reconciles to a zero-mutation no-op". | `insert(end.parentNode, value, end, [...ctx.existing])` for every fill — the reactive branch's own call (`client.ts:901–907`), now the only branch, ≈ 0 extra. **Net ≈ −620.** No runtime cost for static fills (the "one effect per fill" concern does not arise). The zombie heuristic loses its input (DR-5 calls it unreachable anyway); the marker-less `createFrame` consumer path (`client.ts:911–913`) needs an anchor or goes — public surface, flagged in §5. | **confirmed** |
| **R.version** — `FrameImpl.#version`/`get version`, the `v < #version` and `v > #version` arms of `apply`, `rebase`, `#resetStreamState`, `#appliedRootValue`'s value-skip, `clearStreamRecords`, `rebind`'s three resets | 504 | L2 ruling 5 provenance (`scheduler.ts:question`/`nextQuestion`/`MAINLINE_QUESTION` 486–494; `lanes.ts:stale(el, q)` 734–736); A18 supersession; A30 (a frame is replaced by its landing). | **Kept as transport, not R:** `bump` + `versions` (≈ 176) and the chunk restamp in `applyFrames.drain` (≈ 60) — the client is the only party that orders responses across transports, and chunks are not flights; `createFrameHost.write`'s one guard (≈ 60) stays while the resident store is a mount-less object rather than a node. **R:** `#version` + the `v < #version` arm (**dead for host-driven writes** — the host guards first and `register` immediately `rebase`s; only a direct `Frame.apply` caller reaches it), `rebase`, `#resetStreamState` 115 → one applied record ≈ 45, `#appliedRootValue`'s value compare → a record-identity compare (so a byte-identical root under a new version applies: C7 (c)), `clearStreamRecords`' key filter and `root` parameter (1.4 full). **Net ≈ −250 to −400.** | **partial** |
| **R.claim** — `gatherClaims`, `hasPendingFragment`, `claimRender`'s registry/hydrating save-restore and root-registry hand-over | 472 | `solid/src/client/hydration.ts:resumeBoundaryHydration` 2487–2546 (registry/gather swap, `gather(id)`, `_hydratingValue`, `_claimOwner`, `markSnapshotScope`, `set(); flush()`), `initBoundaryResume` 2574; `web/src/client.ts:gatherHydratable(element, root)` 2975–3013 is **prefix-scoped document-wide** when a root is given (2994–2999), and the root pass **already skips `[data-fid]` interiors** (2987–3010) — so the range walk and the "hand ownership over from the root registry" step (`client.ts:337–343`) delete nothing. `claimRender` also writes `sharedConfig.hydrating` through the interceptor setter, which runs `checkHydrationComplete()` on restore — core state mutated from outside. | The owner with `id: prefix` + the prefix string (a wire fact) ≈ 40 B; `claimRoots` for a detached range ≈ 30 B (no core form — `isHydrating` is connectivity-based, `web/client.ts:2523–2535`). `claimRender` 365 → ≈ 80. **Net ≈ −470**, given an internal `hydrateWindow(id, fn, roots?)` factored out of `resumeBoundaryHydration` (≈ +40 B in solid, ≈ +12 br on hydrating pages — §5). Using `initBoundaryResume` there gives frames-rulings 3.2's registration for free. | **partial → mostly R** |
| **R.reveal** — `#segmentReady`'s gates and retry, `#revealed`/`#fallbackShown`/`isRevealed`, the two sets' bookkeeping in `#flush`, `#revealSegment`'s `#revealed.add` | 467 | The document runtime's inline reveal mechanics (`web/src/server.ts:1670`, `REPLACE_SCRIPT`: `$dfr` swap + `_$HY.v` + `_$HY.fe` + `$dfd` retry queues, `$dfl` fallback, `$dfs`/`$dfc` style counts) and the fragment ledger (`hydration.ts:2650–2770`, published as `_$HY.fr` at 1875–1897). | **The DOM swap half is transport and stays** (`#revealSegment`'s swap ≈ 250, `#showFallback` 154, `findPlaceholder`/`rangeClose`/`isPlaceholderStart`/`placeholderId` ≈ 330): fragment keys are hydration ids under the default `renderId` (`solid/src/server/hydration.ts:561`, `frame-sink.ts:852`), two frames on a page both carry `pl-0`, and `$dfr` resolves with `document.getElementById`; and `REPLACE_SCRIPT` is **inline server output** — a CSR-booted page that later streams a frame has no `$dfr` at all. Routing the stream face through the document runtime needs a module copy of `$dfr`/`$dfl` in solid (≈ 500 B min / ≈ 150 br on **every hydrating page**) or frames keeps its DOM half. **R, deletable now:** the two sets, `isRevealed`, the style-gate half of `#segmentReady` and the `#fallbackShown` second pass ≈ 200; **R, deletable with the solid seam:** the retry loop and the rest of `#segmentReady` ≈ 270. What always stays: the per-flush "content + reveal record + placeholder in range" test (≈ 70) — a mount seeding from a warm store that already holds `seg:a` + `seg:a:reveal` must still reveal (C8, C14 (c)); "reveal at the moment the reveal record arrives" would lose C7 (a)'s order independence. | **partial** — DR-4's Stage 3 refinement kept `#revealSegment` for the stream face; A0 says one model, but the inline-script fact makes "the core already has it" false for the swap mechanics |
| **R.drain** — `recordsPending`, the `#2968` `#recordRefresh` arm of `#syncSlots`, `dispose`'s clear, the per-record `host.apply` + `appliedRecords` in `drainRecords` | 409 | `hydration.ts:readSerializedOrCompute` 512–580 / `readHydratedValue` 474–496 (a hydrating node reads its serialized answer before it computes) and `initBoundaryResume` (a hold is a pending boundary — frames-rulings 3.1 ruled, 3.2). **But** an absent record **computes immediately** (527: `if (!has(id)) compute(prev)`); the "compute is deferred until the adopted answer lands" form applies only to a **declared** pending ref (`initP.then`, 484–485; `_fr` at 3074–3178). | The `_$HY.r` key read stays as the document face's inline-record transport (`drainRecords` as one write ≈ 300 — T, counted there; deletes whole only under DR-4/S9). The defer deletes **if the record is declared pending on the wire** — the document sink writes `sc:slot:<fid>:<occ>` as a declared ref at the marker (as `registerFragment` writes `<id>_fr`, `server.ts:2850`) and settles it with the args: then the fill's record read is `sharedConfig.load(key)` ≈ 60 B, the hold is a boundary resume through `initBoundaryResume` (≈ +25 solid / +100 frames, the rulings' 3a), and `recordsPending` 121 + the arm ≈ 150 + `appliedRecords` go. Without the wire change the client keeps a **bounded poll ≈ 120 B**. One more finding: the "recordless is ambiguous" premise is false — the sink mints every called occurrence as `prop#n` (`frame-sink.ts:1101–1115`) and a bare `prop` is direct-insert by design (`frame-client.ts:1340–1341`), so `#` decides the class and an absent `prop#n` record is simply a pending read; today's defer **over-applies** to bare occurrences, deferring direct-insert content until `recordsPending()` flips — a latency cost nobody ruled for. **Net ≈ −270** with the wire change. | **partial** — R against the hydration adoption rule, but the deferral form needs a declared record (server half) |
| **R.error** — `#errorNotified`, `#flush`'s once-per-stream error notify, `slotArgsProxy.get.make`'s stamp fast-adopt | 156 | The frame's `:error` is its one async value erroring — the gate/`<Errored>` reads it (A0 outward); the promise resolves once, so a latch is redundant. `hydration.ts:readHydratedValue` 486–493 is the **identical** branch (`s === 2` throw, `s === 1` return `v`). | `readHydratedValue(raw, noop)` ≈ 40 B vs the inline ≈ 50 — net ≈ −10; the gain is the shared #2997 rejection-observe (`initP.then(undefined, () => {})`, 490) the frames copy **lacks**: a rejected record-revived promise can surface as an unhandled rejection today. Needs `readHydratedValue` exported from `solid-js/internal` (≈ +10 B). The signals core itself does not fast-adopt `s`/`v` stamps (no such code in `async.ts`; `readHydratedValue`'s comment at 482–483 saying it would is wrong). | **confirmed** (small) |
| **R.claimant** — `claimRegionFragments`, `claimedFragments`, the `fr.claim`/`fr.release` lines and the cascade's claim half | 153 | `hydration.ts:fragmentPolicy` 2661–2666 (a post-done swap needs `f.claimed`), `claimFragment` 2684, `releaseFragment` 2692, `replayHeldFragment` 2673. frames-rulings 3.3: the ledger should know a fragment inside an adopted frame's range is the frame's content. | `fr.adopt(el)` + `onCleanup(() => fr.unadopt(el))` ≈ 30 B, given a ledger seam: `_adoptedRoots: Set<Element>` and `fragmentPolicy` swapping when `getElementById("pl-" + id)` is inside an adopted root (≈ +80 B in solid, ≈ 0 cost while the set is empty). Nested reveals are then handled by geometry at swap time, no rescan. **Net ≈ −240.** | **confirmed** (with a ledger seam) |
| **R.refwait** — `#refsUnresolved`, the `continue` in `#syncSlots`, the threaded `resolve` parameter | 145 | DR-2's value tier already routes an async arg through a transparent memo that pends (`client.ts:401–452`, `handleAsync`'s thenable branch). | The table lookup returns a **pending** promise for an undelivered key, rejected at `complete`/`:error` (L1): ≈ 60 B in the table wrapper (the lazy decode chunk) + ≈ 40 B reject-at-complete, and the resolution pinned to the table object current at the record's apply — frames-rulings 1.2's per-response cell (counted under R.stage). **Net ≈ −250** on the eager client. A live occurrence then holds its previous value through the wait (A17) instead of skipping the apply — same screen — and the hold registers through the fill's boundary (3.2). Today a ref whose data never comes leaves the record unapplied **silently** (an L1 hole); the A0 form surfaces it. | **confirmed** |

Two groups the SC audit counted as incidental and A0 moves to R: the two
version spaces (audit §4 "two version spaces") and the two gates. Two the
audit counted as *structural* and A0 moves to R: the staging carrier
(audit §4: "the rulings (71–75) are structural; the shape … is the
incidental part" — under A0 the shape *is* the finding) and the static
fill path (not in the audit's list at all; found by asking what `insert`
already does).

### 1.3 F — the feature groups

| group | B (adjusted) | audit letter | what it buys | notes |
| --- | --: | --- | --- | --- |
| **F.bind** — `bindDataOccurrence` (+ `valuesFor`/`write`/`release`/`writeText`), `slotPositions`, `slotEntry`, `textPosition`, `consumersOf`, `consumersEqual`, `ownedPositions`, `morphOwnedClass`/`Style`, `applyOwned`, `isTextStart`/`afterText`, `#slotConsumers`/`#slotRebinders`, the `_s:` branch of `collectSlots`, the consumer-rebind arm of `#syncSlots`, `positions`/`onRebind` in `#invokeSlot`, the owned-position arms of `morphAttributes`/`reconcileChildren`, the `ctx.positions` branch of `slotsFor` | 4,508 | **E.c** (Stage 7, #3704/#3714) | attribute, class/style and text positions in server markup bound to a client fill that runs once | ≈ 300 of it is a second diff layer above `web:assign` (`prev`/`handlers`/`clearing`/`handlerOwners`) — D-like, inside the tier |
| **F.live** — `resume`, `hold`, `connections`, `bump`'s cancel, `encodeHaveList`, `FRAME_HAVE_*`, `applyFrames`' `connection` wiring + `cancel`, the `LIVE_WIRE` arm of `handle`, `chunkToRecords`' `hole`/`attr`/digest cases, `#applyHole`, `#applyAttrs`, `findLiveTarget`, `#appliedHoles`, `#have`/`have`/`#recordHave`, `#flush`'s hole pass, `pumpLiveChannel`, `liveOps`/`liveAppliers`, `applyLiveOp` + catch-up, `isEventStream`, `deserializeStream`'s live arm | 3,522 | **E.a** (Stage 8 B2–B4) | live/GET re-emission of holes and attrs, reconnect with a have-list, the document live channel | reachable without `live()` (the document channel), so the tier key is "the server emitted holes or a channel", as the audit's §7 Q4 asks |
| **F.assets** — `ensureStylesheet`, `ensurePreload`, `ensureModulePreload`, `applyInlineStyles`, `qualifierValue`, `findHeadElement`, `PRELOAD_QUALIFIERS`, `#processedAssets`, `#styleFlush`, `#flush`'s assets pass, `#segmentReady`'s style gate, `createFrameHost.write`'s `seg::assets` accumulate, `chunkToRecords`' `assets` case | 2,082 | audit S10 | stylesheets gating a streamed segment's reveal, typed preloads, module preloads, inline styles | an import-free mirror of `web`'s `acquireAsset`/`findAssetElement`/`head.ts:qualifierValue`; `ensureStylesheet` + `applyInlineStyles` (≈ 700) are reached by no client or hydrate test. Without the group a streamed segment's stylesheet **never loads** — not FOUC, no CSS (the document face keeps the core's `$dfs`; the stream face has no core carrier) |
| **F.regions** — `#bindRegions`, `#regionsFor`, `#discoverRegions`, `collectRegionElements`, `disposeRegions`, `makeFrameElement`, `isFrameRef`, the `{$frame}` arm of `#resolveArgs`, the `resolveSlot`/`resolveSlotRecord`/`removeSlotRecord` thread-up, `#slotRegions`, `tableFor`'s prefix walk, `drainRecords`' `sc:region:` arm | 1,393 | audit S7 (regions as store substructure) | server content passed as a prop to a client fill (`{$frame}`), rendered as a nested frame; occluded regions | the rename machinery (`renameRegion`, `#reconcileRegions`, the rename arm) is D, not here |
| **F.trace** — `reviveContainerTraces`, `materialize`, `isContainerTraceMarker`, `isMaterializedContainer`, `setContainerTraceMaterializer`, `getFrameHost`'s `revive`/`isContainer`, the container checks in `slotArgsProxy`/`#refArgsUnchanged` | 843 | **N** (DR-2 container tier) | a live store as a slot arg | the eager half only; it pulls 31,481 B of store engine + adapters into a page (audit B.2) — on the frames scenario those are external |
| **F.claims** — `claimHandlers`, `claimNode`, `claimedAttr`, `claimTree`, `#claimTree`, `#claimContent`, the `claim` thread through the morph | 527 | **X** | router link-state claims (`a[href]`, `form[action]`) on server-produced markup | the router contract (`CLAIM_SEAM`) |
| **F.event** — `#applied`'s `CustomEvent` dispatch, `FRAME_APPLIED_EVENT` | 160 | — | `frame:applied` for scroll restoration / affordance reflection | the router contract |

### 1.4 D — dead and incidental

| unit | B | why |
| --- | --: | --- |
| `installServerComponents.g._$SC.r` (+ `.c[i]`) | 207 | the `_$SC` bootstrap exists twice — the server's `SERVER_COMPONENT_BOOTSTRAP_EXPR` and this client mirror (audit S9) |
| `FrameImpl##reconcileRegions`, `renameRegion`, the rename arm of `#resolveArgs` | 307 | region wire-id renames reconciled at three sites (principles §4 row 19: compensatory) |
| `isAsyncValue` | 119 | the same probe as `isAsyncLike`, spelled twice because `frame-client.ts` is importless |
| `documentAddress` | 91 | scans `_$SC.a` because the t = 0 record does not carry the address to the mount (deletes with the mirror) |
| `FrameImpl#contentHTML` + `unregister`'s capture arm | 262 | the last-unmount interior capture (principles §4 row 3 residue; unpinned) |
| the zombie heuristic in `#syncSlots` | 120 | DR-5: unreachable under identity-first matching |
| the `adopted` fork in `#invokeSlot` | 100 | principles §4 row 14 — kept in T's byte count below, listed here as the audit did; deletes only when A5 removes the t = 0 difference |
| `slotsFor`'s second dispose-previous map (`bindings` beside `fillScopes`) | 250 | identical bookkeeping twice |
| the imperative (no-`reveal`-hook) branch of `#revealSegment` | 90 | dead on Solid pages (the binding always passes the seam) |
| `boundaryWaiters` + its loop in `installRevealHook`, beside `arrivals` | 110 | two waiters for one question (audit S9) — one deferred answer suffices, provided `documentBoundary` pends on it (the contract analysis's G9) |
| `bindDataOccurrence.write`'s second diff layer | 300 | above `assign`'s diff (inside the F.bind tier) |
| `showing`'s `COMPONENT_BINDING` brand | 60 | a patch so cache-seeded readers pass `dynamic`'s equals-gate |
| the sf client's `GET` proxy re-implementation, `createRequest`'s and `serializeArguments`' prod message text | ≈ 880 | page base only |

### 1.5 Top 40 units (frames eager, min B, by whole unit)

| # | unit | module | min B | class | group | justification |
| --: | --- | --- | --: | --- | --- | --- |
| 1 | `FrameImpl##syncSlots` | web/frames | 1,227 | **T** | T.slots | occurrence discovery → mount / update / re-call / unmount; carries the `#2968` arm (R.drain 150), the `{$ref}` `continue` (R.refwait 40), the adopt arm (R.dedupe 80), the zombie heuristic (D 120), the consumer rebind (F.bind 150) |
| 2 | `FrameImpl##flush` | web/frames | 1,146 | **T** | T.store | root apply → error notify → segments → holes → assets → sync; carries the hole pass (F.live 330), the assets pass (F.assets 150), the two reveal sets (R.reveal 180), the error latch (R.error 60) |
| 3 | `<module>` (frames) | web/frames | 1,025 | **T** | T.wire | brands, headers, regexes, the plugin object; `liveOps`/`liveAppliers` (F.live 60), `handlerOwners` (F.bind 30), `stagedContent`/`STAGED_DATA`/`CONTENT_TOKEN` (R.stage 40), `boundaryWaiters` (D 30) |
| 4 | `reconcileChildren` | web/frames | 941 | **T** | T.morph | identity-first sibling reconcile (A7, DR-5); the text-pair arm is F.bind 60 |
| 5 | `slotsFor.get` | web/frames | 854 | **T** | T.slots | the per-prop fill: dispose the previous, pick the branch, claim or render; two dispose maps (D 250), the `positions` branch (F.bind 200) |
| 6 | `chunkToRecords` | web/frames | 815 | **T** | T.store | wire chunk → keyed store write (A3); `hole`/`attr`/digest cases F.live 250, the gate records R.reveal 60 |
| 7 | `bindDataOccurrence.write` | web/frames | 652 | **F** | F.bind | write positions through `assign`; its own diff state is the D-like 300 |
| 8 | `FrameImpl##applyAttrs` | web/frames | 607 | **F** | F.live | attr-hole re-emission |
| 9 | `stableString` | web/server-functions | 601 | **T** | T.wire | address hashing (every call with arguments) |
| 10 | `adoptBoundary` | web/frames | 587 | **T** | T.doc | bind an adopting frame over the SSR'd element, hand hydration the node; the switch gate twin R.gate 170, the live appliers F.live 60 |
| 11 | `ChunkReader#next` | web/server-functions | 558 | **T** | T.wire | `;0x<8 hex>;` framing |
| 12 | `createServerComponentHandler.handle` | web/frames | 552 | **T** | T.wire | response → address → binding, the error-to-record catch; the `LIVE_WIRE` arm F.live 150, the stage decision R.stage 110 |
| 13 | `FrameImpl##refArgsUnchanged` | web/frames | 530 | **R** | R.dedupe | value-compare of a re-sent record's refs — a memo's `equals` (A18 (a)) |
| 14 | `installServerComponents` | web/frames | 521 | **T** | T.doc | wire the handler, intercept, `showing` drain, `configureServerFunctionsClient` |
| 15 | `FrameImpl#preview` | web/frames | 505 | **R** | R.stage | re-implements the args-update arm for a staged response — A29: a pass served a staged value re-derives |
| 16 | `ChunkReader#readChunk` | web/server-functions | 492 | **T** | T.wire | framing |
| 17 | `morphAttributes` | web/frames | 490 | **T** | T.morph | owned positions F.bind 80, the claim recheck F.claims 40 |
| 18 | `FrameImpl##invokeSlot` | web/frames | 483 | **T** | T.slots | ctx construction + the callback under scope; the `adopted` fork D 100, `positions`/`onRebind` F.bind 60 |
| 19 | `applyFrames.drain` | web/frames | 461 | **T** | T.wire | chunk parse → restamp → `host.apply`; awaits `prepareData` before `data` |
| 20 | `FrameImpl##revealSegment` | web/frames | 447 | **T** | T.morph | the segment swap for the stream face (`$dfr`'s mechanics; keys collide document-wide and `REPLACE_SCRIPT` is inline server output); `#revealed.add` R.reveal 40, `applyInlineStyles` F.assets 40, the imperative branch D 90 |
| 21 | `deserializeStream` | web/server-functions | 446 | **T** | T.decode | codec seam; the live arm is F.live 150 |
| 22 | `ownedPositions` | web/frames | 444 | **F** | F.bind | |
| 23 | `bindDataOccurrence` | web/frames | 443 | **F** | F.bind | the fill runs once, positions written per element |
| 24 | `ensureStylesheet` | web/frames | 423 | **F** | F.assets | the stylesheet gate (reached by no client test) |
| 25 | `createServerComponentHandler.applyFlightResponse` | web/frames | 418 | **T** | T.flight | single-flight envelope: regions → stores, outcomes → `deliverFlightData`; the staged regions R.stage 150 |
| 26 | `bindDataOccurrence.valuesFor` | web/frames | 396 | **F** | F.bind | |
| 27 | `adoptBoundary.drainRecords` | web/frames | 367 | **T** | T.doc | the document face's inline-record transport (`_$HY.r` → the address's store); the per-record apply + `appliedRecords` R.drain 100; deletes whole under DR-4/S9 |
| 28 | `FrameImpl##resolveArgs` | web/frames | 366 | **T** | T.slots | args → props; the `{$frame}` arm F.regions 110, the rename arm D 60, the ref cache R.dedupe 40 |
| 29 | `claimRender` | web/frames | 365 | **T** | T.claim | scoped hydration re-entry under `sc-<frame>-<key>-`; the save-restore + hand-over R.claim 140 |
| 30 | `installRevealHook` | web/frames | 354 | **T** | T.doc | ledger subscription: extend the index at each reveal, settle deferred answers; the `boundaryWaiters` loop D 60 |
| 31 | `createServerComponentHandler` | web/frames | 351 | **T** | T.wire | the handler closure: maps, `resolveServerComponent`, option wiring; `stagedContent` wiring R.stage 60 |
| 32 | `collectSlots` | web/frames | 340 | **T** | T.slots | the marker walk; the `_s:` branch F.bind 100 |
| 33 | `consumersEqual` | web/frames | 333 | **F** | F.bind | |
| 34 | `applyFrames` | web/frames | 332 | **T** | T.wire | read a frame-stream Response; open-frame death accounting (L1); `connection` wiring F.live 100 |
| 35 | `FrameImpl#apply` | web/frames | 326 | **T** | T.store | the write loop; the version arms R.version 110 (the `v <` arm is dead for host-driven writes), the slot dedupe arm R.dedupe 90 |
| 36 | import statements | — | 314 | **T** | T.wire | the five externals' imports (no source position) |
| 37 | `boundaryComponent` | web/frames | 307 | **R** | R.gate | the shell gate: `arm`/`release`/`settle`/`setGate`, the gate signal and the two memos; `createFrameElement(...)` + `onCleanup` + return are T 110 |
| 38 | `createFrameHost.write` | web/frames | 302 | **T** | T.store | the one version guard + the store write; the `seg::assets` accumulate F.assets 120 |
| 39 | `FrameImpl#dispose` | web/frames | 282 | **T** | T.store | teardown; `#recordRefresh` clear R.drain 30, `disposeRegions` F.regions 40 |
| 40 | `applyInlineStyles` | web/frames | 275 | **F** | F.assets | reached by no client test |

Every unit — all 303 on the frames scenario and the 337 frames + sf units of
page base — is in Appendix A with its class and group.

---

## 2. The transport floor

_(pending)_

---

## 3. Tiers

_(pending)_

---

## 4. Verdict

_(pending)_

---

## 5. Open questions

_(pending)_

---

## 6. Sources

_(pending)_

---

## 7. Reproducing

_(pending)_

---

## Appendix A — every unit

### A.1 Frames eager-client scenario (303 units, 43,310 B; by whole unit)

| unit | module | min B | class | group |
| --- | --- | --: | --- | --- |
| `FrameImpl##syncSlots` | web/frames | 1227 | T | T.slots |
| `FrameImpl##flush` | web/frames | 1146 | T | T.store |
| `<module>:web/frames` | web/frames | 1025 | T | T.wire |
| `reconcileChildren` | web/frames | 941 | T | T.morph |
| `slotsFor.get` | web/frames | 854 | T | T.slots |
| `chunkToRecords` | web/frames | 815 | T | T.store |
| `bindDataOccurrence.write` | web/frames | 652 | F | F.bind |
| `FrameImpl##applyAttrs` | web/frames | 607 | F | F.live |
| `stableString` | web/server-functions | 601 | T | T.wire |
| `adoptBoundary` | web/frames | 587 | T | T.doc |
| `ChunkReader#next` | web/server-functions | 558 | T | T.wire |
| `createServerComponentHandler.handle` | web/frames | 552 | T | T.wire |
| `FrameImpl##refArgsUnchanged` | web/frames | 530 | R | R.dedupe |
| `installServerComponents` | web/frames | 521 | T | T.doc |
| `FrameImpl#preview` | web/frames | 505 | R | R.stage |
| `ChunkReader#readChunk` | web/server-functions | 492 | T | T.wire |
| `morphAttributes` | web/frames | 490 | T | T.morph |
| `FrameImpl##invokeSlot` | web/frames | 483 | T | T.slots |
| `applyFrames.drain` | web/frames | 461 | T | T.wire |
| `FrameImpl##revealSegment` | web/frames | 447 | T | T.morph |
| `deserializeStream` | web/server-functions | 446 | T | T.decode |
| `ownedPositions` | web/frames | 444 | F | F.bind |
| `bindDataOccurrence` | web/frames | 443 | F | F.bind |
| `ensureStylesheet` | web/frames | 423 | F | F.assets |
| `createServerComponentHandler.applyFlightResponse` | web/frames | 418 | T | T.flight |
| `bindDataOccurrence.valuesFor` | web/frames | 396 | F | F.bind |
| `adoptBoundary.drainRecords` | web/frames | 367 | T | T.doc |
| `FrameImpl##resolveArgs` | web/frames | 366 | T | T.slots |
| `claimRender` | web/frames | 365 | T | T.claim |
| `installRevealHook` | web/frames | 354 | T | T.doc |
| `createServerComponentHandler` | web/frames | 351 | T | T.wire |
| `collectSlots` | web/frames | 340 | T | T.slots |
| `consumersEqual` | web/frames | 333 | F | F.bind |
| `applyFrames` | web/frames | 332 | T | T.wire |
| `FrameImpl#apply` | web/frames | 326 | T | T.store |
| `<unmapped>` | <unmapped> | 314 | T | T.wire |
| `boundaryComponent` | web/frames | 307 | R | R.gate |
| `createFrameHost.write` | web/frames | 302 | T | T.store |
| `FrameImpl#dispose` | web/frames | 282 | T | T.store |
| `applyInlineStyles` | web/frames | 275 | F | F.assets |
| `morphOwnedStyle` | web/frames | 274 | F | F.bind |
| `normalizeSlotContent` | web/frames | 274 | R | R.insert |
| `slotPositions` | web/frames | 261 | F | F.bind |
| `qualifierValue` | web/frames | 260 | F | F.assets |
| `reviveContainerTraces` | web/frames | 257 | F | F.trace |
| `morphOwnedClass` | web/frames | 256 | F | F.bind |
| `createFrameHost.unregister` | web/frames | 253 | T | T.store |
| `FrameImpl#rebind` | web/frames | 252 | T | T.store |
| `documentBoundary` | web/frames | 249 | T | T.doc |
| `collectRegionElements` | web/frames | 248 | F | F.regions |
| `findHeadElement` | web/frames | 245 | F | F.assets |
| `ensurePreload` | web/frames | 238 | F | F.assets |
| `flushGrafts` | web/frames | 233 | T | T.morph |
| `FrameImpl##applyRoot` | web/frames | 229 | T | T.morph |
| `textPosition` | web/frames | 229 | F | F.bind |
| `findLiveTarget` | web/frames | 228 | F | F.live |
| `FrameImpl##segmentReady` | web/frames | 227 | R | R.reveal |
| `slotEntry` | web/frames | 220 | F | F.bind |
| `errorFromTrailer` | web/server-functions | 218 | T | T.wire |
| `argsEquivalent` | web/frames | 216 | R | R.dedupe |
| `FrameImpl##bindRegions` | web/frames | 213 | F | F.regions |
| `FrameImpl##unmountSlot` | web/frames | 204 | T | T.slots |
| `FrameImpl##applied` | web/frames | 200 | F | F.event |
| `FrameImpl#constructor` | web/frames | 200 | T | T.store |
| `createServerComponentHandler.stage` | web/frames | 187 | R | R.stage |
| `deliverFlightData` | web/server-functions | 185 | T | T.flight |
| `followAddress` | web/frames | 185 | R | R.gate |
| `createFrameHost.apply` | web/frames | 182 | T | T.store |
| `FrameImpl##applyHole` | web/frames | 181 | F | F.live |
| `createFrameHost.register` | web/frames | 179 | T | T.store |
| `createServerComponentHandler.resume` | web/frames | 178 | F | F.live |
| `createServerComponentHandler.bump` | web/frames | 176 | T | T.wire |
| `hasPendingFragment` | web/frames | 176 | R | R.claim |
| `materialize` | web/frames | 173 | F | F.trace |
| `compatible` | web/frames | 170 | T | T.morph |
| `installServerComponents.g._$SC.r` | web/frames | 168 | D | D |
| `FrameImpl##reconcileRegions` | web/frames | 164 | D | D |
| `createChunk` | web/server-functions | 163 | T | T.wire |
| `ensureModulePreload` | web/frames | 162 | F | F.assets |
| `adoptRange` | web/frames | 160 | T | T.morph |
| `claimTree` | web/frames | 157 | F | F.claims |
| `gatherClaims` | web/frames | 156 | R | R.claim |
| `applyOwned` | web/frames | 155 | F | F.bind |
| `applyFrames.end` | web/frames | 155 | T | T.wire |
| `morphNode` | web/frames | 155 | T | T.morph |
| `adoptBoundary.claimRegionFragments` | web/frames | 153 | R | R.claimant |
| `FrameImpl##showFallback` | web/frames | 153 | T | T.morph |
| `bindDataOccurrence.writeText` | web/frames | 153 | F | F.bind |
| `isContainerTraceMarker` | web/frames | 152 | F | F.trace |
| `createFrameHost` | web/frames | 150 | T | T.store |
| `pumpLiveChannel` | web/frames | 148 | F | F.live |
| `findPlaceholder` | web/frames | 146 | T | T.morph |
| `slotsFor.get.settle` | web/frames | 143 | R | R.insert |
| `slotArgsProxy.get.make` | web/frames | 140 | T | T.slots |
| `stashRange` | web/frames | 139 | T | T.morph |
| `pumpLiveChannel.pump` | web/frames | 137 | F | F.live |
| `encodeHaveList` | web/frames | 136 | F | F.live |
| `findRangeStart` | web/frames | 130 | T | T.morph |
| `moveRangeBefore` | web/frames | 130 | T | T.morph |
| `slotsFor.get.evaluate` | web/frames | 128 | T | T.slots |
| `applyFrames.connection.cancel` | web/frames | 127 | F | F.live |
| `makeFrameElement` | web/frames | 127 | F | F.regions |
| `afterMarker` | web/frames | 125 | T | T.slots |
| `createServerComponentHandler.applyFlightResponse.version` | web/frames | 125 | T | T.flight |
| `createFrameHost.preview` | web/frames | 124 | R | R.stage |
| `FrameImpl##regionsChange` | web/frames | 123 | R | R.stage |
| `eachInRange` | web/frames | 122 | T | T.slots |
| `adoptBoundary.recordsPending` | web/frames | 121 | R | R.drain |
| `ServerComponentPlugin.deserialize` | web/frames | 121 | T | T.refs |
| `ChunkReader#constructor` | web/server-functions | 119 | T | T.wire |
| `isAsyncValue` | web/frames | 119 | D | D |
| `findBoundaryElement` | web/frames | 116 | T | T.doc |
| `createServerComponentHandler.showing` | web/frames | 116 | T | T.doc |
| `awaitBoundary` | web/frames | 115 | T | T.doc |
| `FrameImpl##resetStreamState` | web/frames | 115 | R | R.version |
| `hashArguments` | web/server-functions | 115 | T | T.wire |
| `indexBoundaries` | web/frames | 114 | T | T.doc |
| `configureServerFunctionsClient` | web/server-functions | 113 | T | T.wire |
| `rangeClose` | web/frames | 112 | T | T.morph |
| `slotArgsProxy.get` | web/frames | 111 | T | T.slots |
| `isReactiveContent` | web/frames | 111 | R | R.insert |
| `tableFor` | web/frames | 105 | T | T.decode |
| `createServerComponentHandler.stage.entry.commit` | web/frames | 104 | R | R.stage |
| `FrameImpl##refsUnresolved` | web/frames | 104 | R | R.refwait |
| `<module>:web/server-functions` | web/server-functions | 101 | T | T.wire |
| `flightCodec` | web/frames | 101 | T | T.refs |
| `FrameImpl##recordHave` | web/frames | 101 | F | F.live |
| `FrameImpl##removeSlotRecord` | web/frames | 101 | F | F.regions |
| `clearStreamRecords` | web/frames | 100 | R | R.version |
| `revealSeam` | web/frames | 100 | T | T.slots |
| `isAsyncLike` | web/frames | 98 | T | T.slots |
| `hasFlightMetadata` | web/server-functions | 96 | T | T.flight |
| `isEventStream` | web/server-functions | 96 | F | F.live |
| `slotsFor` | web/frames | 95 | T | T.slots |
| `createServerComponentHandler.bindingFor` | web/frames | 93 | T | T.wire |
| `FrameImpl##replaceRange` | web/frames | 93 | R | R.insert |
| `documentAddress` | web/frames | 91 | D | D |
| `createFrameHost.serialize` | web/frames | 90 | T | T.refs |
| `consumersOf` | web/frames | 89 | F | F.bind |
| `applyFrames.errorRecord` | web/frames | 89 | T | T.wire |
| `ensureTable` | web/frames | 86 | T | T.decode |
| `loadCodec` | web/frames | 86 | T | T.decode |
| `parseFragment` | web/frames | 86 | T | T.morph |
| `ServerComponentPlugin.serialize` | web/frames | 86 | T | T.refs |
| `isSlotMarker` | web/frames | 85 | T | T.slots |
| `slotStartId` | web/frames | 85 | T | T.slots |
| `boundaryScope` | web/frames | 84 | T | T.slots |
| `FrameImpl##resolveSlotRecord` | web/frames | 84 | F | F.regions |
| `liveSlotProps` | web/frames | 84 | T | T.slots |
| `renameRegion` | web/frames | 83 | D | D |
| `boundaryMayArrive` | web/frames | 82 | T | T.doc |
| `createFrameElement` | web/frames | 81 | T | T.store |
| `FrameImpl##regionsFor` | web/frames | 80 | F | F.regions |
| `installServerComponents.intercept` | web/frames | 80 | T | T.doc |
| `slotArgsProxy.getOwnPropertyDescriptor` | web/frames | 79 | T | T.slots |
| `parse.async` | web/frames | 78 | T | T.refs |
| `removeUntil` | web/frames | 77 | T | T.morph |
| `claimHandlers` | web/frames | 76 | F | F.claims |
| `ChunkReader#drain` | web/server-functions | 75 | T | T.wire |
| `getFrameHost` | web/frames | 75 | T | T.decode |
| `isMaterializedContainer` | web/frames | 75 | F | F.trace |
| `slotArgsProxy` | web/frames | 75 | T | T.slots |
| `FrameImpl##discoverRegions` | web/frames | 74 | F | F.regions |
| `createServerComponentHandler.stage.entry.apply` | web/frames | 73 | R | R.stage |
| `FrameImpl##resolveRef` | web/frames | 73 | T | T.decode |
| `createFrameHost.storeFor` | web/frames | 73 | T | T.store |
| `FrameImpl#contentHTML` | web/frames | 72 | D | D |
| `slotsFor.get.bind` | web/frames | 71 | T | T.slots |
| `createServerComponentHandler.stage.entry.preview` | web/frames | 71 | R | R.stage |
| `FrameImpl##runSlotCleanups` | web/frames | 71 | T | T.slots |
| `deserializeStream.interpretChunk` | web/server-functions | 71 | T | T.decode |
| `FrameImpl##claimContent` | web/frames | 70 | F | F.claims |
| `placeRange` | web/frames | 69 | T | T.morph |
| `adoptBoundary.applyLiveOp` | web/frames | 68 | F | F.live |
| `createServerComponentHandler.hold` | web/frames | 68 | F | F.live |
| `preservesOpen` | web/frames | 66 | T | T.morph |
| `parseServerComponent` | web/frames | 65 | T | T.refs |
| `propOf` | web/frames | 65 | T | T.slots |
| `segmentName` | web/frames | 64 | T | T.store |
| `deserializeStream.end` | web/server-functions | 63 | F | F.live |
| `createServerComponentHandler.applyFlightResponse.regionOf` | web/frames | 63 | R | R.stage |
| `FrameImpl##revealSegment.content` | web/frames | 62 | T | T.morph |
| `FrameImpl##firstContent` | web/frames | 61 | T | T.morph |
| `createServerComponentHandler.componentFor` | web/frames | 59 | T | T.wire |
| `disposeRegions` | web/frames | 58 | F | F.regions |
| `getFlightDataConsumer` | web/server-functions | 58 | T | T.flight |
| `createFrameHost.get` | web/frames | 57 | T | T.store |
| `isPlaceholderStart` | web/frames | 57 | T | T.morph |
| `FrameImpl##claimTree` | web/frames | 56 | F | F.claims |
| `isFrameElement` | web/frames | 55 | T | T.store |
| `createServerComponentHandler.stage.entry.stream` | web/frames | 54 | R | R.stage |
| `createFrameHost.resolve` | web/frames | 53 | T | T.decode |
| `stageTables` | web/frames | 53 | R | R.stage |
| `FrameImpl##resolveSlot` | web/frames | 52 | F | F.regions |
| `createServerComponentHandler.named` | web/frames | 52 | R | R.stage |
| `bindDataOccurrence.write.st.ref` | web/frames | 52 | F | F.bind |
| `claimNode` | web/frames | 51 | F | F.claims |
| `isFrameRef` | web/frames | 51 | F | F.regions |
| `adoptBoundary.drainRecords.apply` | web/frames | 50 | T | T.doc |
| `ensureStylesheet.settle` | web/frames | 50 | F | F.assets |
| `FrameImpl##scoped` | web/frames | 49 | T | T.slots |
| `isDataRef` | web/frames | 49 | T | T.decode |
| `isTextStart` | web/frames | 49 | F | F.bind |
| `bindDataOccurrence.release` | web/frames | 49 | F | F.bind |
| `createServerComponentHandler.applyFlightResponse.target.apply` | web/frames | 49 | T | T.flight |
| `frameAddress` | web/server-functions | 48 | T | T.wire |
| `FrameImpl##materialize` | web/frames | 47 | T | T.morph |
| `createFrame` | web/frames | 46 | T | T.store |
| `applyFrames.end.sweep` | web/frames | 46 | T | T.wire |
| `ServerComponentPlugin.test` | web/frames | 45 | T | T.refs |
| `getFlightDataSourceIds` | web/server-functions | 43 | T | T.flight |
| `FrameImpl##findPlaceholder` | web/frames | 41 | T | T.morph |
| `FrameImpl##parent` | web/frames | 40 | T | T.morph |
| `isFrameStreamResponse` | web/frames | 40 | T | T.wire |
| `ChunkReader#cancel` | web/server-functions | 39 | T | T.wire |
| `stageTables.commit` | web/frames | 39 | R | R.stage |
| `installServerComponents.g._$SC.r.g._$SC.c[i]` | web/frames | 39 | D | D |
| `contentAddress` | web/frames | 38 | R | R.stage |
| `followAddress.drop` | web/frames | 38 | R | R.gate |
| `FrameImpl##clearContent` | web/frames | 38 | T | T.morph |
| `boundaryComponent.settle` | web/frames | 38 | R | R.gate |
| `adoptBoundary.settle` | web/frames | 38 | R | R.gate |
| `claimedAttr` | web/frames | 37 | F | F.claims |
| `FrameImpl#get error` | web/frames | 37 | T | T.store |
| `FrameImpl#isRevealed` | web/frames | 36 | R | R.reveal |
| `createServerComponentHandler.applyFlightResponse.onOutcome` | web/frames | 36 | T | T.flight |
| `setContainerTraceMaterializer` | web/frames | 36 | F | F.trace |
| `stageTables.resolve` | web/frames | 34 | R | R.stage |
| `createServerComponentHandler.binding` | web/frames | 33 | T | T.wire |
| `createFrameElement.dispose` | web/frames | 33 | T | T.store |
| `FrameImpl##collectSlots` | web/frames | 33 | T | T.slots |
| `installServerComponents.g._$SC.impl` | web/frames | 33 | T | T.doc |
| `slotArgsProxy.ownKeys` | web/frames | 33 | T | T.slots |
| `getFrameHost.resolve` | web/frames | 32 | T | T.decode |
| `FrameImpl##bindRegions.resolveSlotRecord` | web/frames | 32 | F | F.regions |
| `getFrameHost.applyData` | web/frames | 31 | T | T.decode |
| `beginStream` | web/frames | 31 | T | T.decode |
| `FrameImpl##processedAssets` | web/frames | 31 | F | F.assets |
| `adoptBoundary.arm` | web/frames | 30 | R | R.gate |
| `FrameImpl##bindRegions.removeSlotRecord` | web/frames | 30 | F | F.regions |
| `stageTables.apply` | web/frames | 29 | R | R.stage |
| `FrameImpl##invokeSlot.ctx.onUpdate` | web/frames | 29 | T | T.slots |
| `FrameImpl#get version` | web/frames | 29 | R | R.version |
| `isBoundaryId` | web/frames | 29 | T | T.doc |
| `FrameImpl##styleFlush` | web/frames | 28 | F | F.assets |
| `getServerFunctionsCodec` | web/server-functions | 28 | T | T.decode |
| `createServerComponentHandler.stagedContent.preview` | web/frames | 28 | R | R.stage |
| `FrameImpl##appliedHoles` | web/frames | 27 | F | F.live |
| `FrameImpl##fallbackShown` | web/frames | 27 | R | R.reveal |
| `FrameImpl##mountedSlots` | web/frames | 27 | T | T.slots |
| `FrameImpl##revealed` | web/frames | 27 | R | R.reveal |
| `FrameImpl##slotArgs` | web/frames | 27 | T | T.slots |
| `FrameImpl##slotCleanups` | web/frames | 27 | T | T.slots |
| `FrameImpl##slotConsumers` | web/frames | 27 | F | F.bind |
| `FrameImpl##slotNodes` | web/frames | 27 | T | T.slots |
| `FrameImpl##slotRebinders` | web/frames | 27 | F | F.bind |
| `FrameImpl##slotRegions` | web/frames | 27 | F | F.regions |
| `FrameImpl##slotResolvedRefs` | web/frames | 27 | R | R.dedupe |
| `FrameImpl##slotUpdaters` | web/frames | 27 | T | T.slots |
| `FrameImpl#get store` | web/frames | 27 | T | T.store |
| `afterRange` | web/frames | 26 | T | T.slots |
| `boundaryComponent.arm` | web/frames | 26 | R | R.gate |
| `FrameImpl##bindRegions.resolveSlot` | web/frames | 26 | F | F.regions |
| `createServerComponentHandler.stagedContent.commit` | web/frames | 26 | R | R.stage |
| `stageTables.begin` | web/frames | 25 | R | R.stage |
| `installServerComponents.component` | web/frames | 25 | T | T.doc |
| `asyncArg` | web/frames | 24 | T | T.refs |
| `configureServerFunctionsCodec` | web/server-functions | 24 | T | T.decode |
| `FrameImpl#rebase` | web/frames | 24 | R | R.version |
| `installServerComponents.showing` | web/frames | 24 | T | T.doc |
| `FrameImpl##invokeSlot.ctx.onCleanup` | web/frames | 23 | T | T.slots |
| `FrameImpl##store` | web/frames | 23 | T | T.store |
| `FrameImpl#have` | web/frames | 22 | F | F.live |
| `boundaryComponent.onApply` | web/frames | 22 | R | R.gate |
| `placeholderId` | web/frames | 22 | T | T.morph |
| `createServerComponentHandler.resolveServerComponent` | web/frames | 22 | T | T.wire |
| `createServerComponentHandler.settled` | web/frames | 21 | R | R.stage |
| `slotEnd` | web/frames | 21 | T | T.slots |
| `deserializeStream.end.sweep` | web/server-functions | 21 | F | F.live |
| `slotArgsProxy.has` | web/frames | 20 | T | T.slots |
| `afterText` | web/frames | 19 | F | F.bind |
| `installServerComponents.onStream` | web/frames | 19 | T | T.doc |
| `FrameImpl` | web/frames | 17 | T | T.store |
| `createServerComponentHandler.bindingFor.binding` | web/frames | 16 | T | T.wire |
| `createServerComponentHandler.stage.binding` | web/frames | 16 | R | R.stage |
| `ChunkReader` | web/server-functions | 15 | T | T.wire |
| `createServerComponentHandler.applyFlightResponse.start` | web/frames | 13 | T | T.flight |
| `applyFrames.end.close` | web/frames | 12 | F | F.live |
| `stagedContent.preview` | web/frames | 12 | R | R.stage |
| `stagedContent.commit` | web/frames | 10 | R | R.stage |
| `deserializeStream.end.close` | web/server-functions | 9 | F | F.live |
| `FrameImpl##recordRefresh` | web/frames | 8 | R | R.drain |
| `FrameImpl##disposed` | web/frames | 6 | T | T.store |
| `FrameImpl##errorNotified` | web/frames | 6 | R | R.error |
| `FrameImpl##hasContent` | web/frames | 6 | T | T.store |
| `FrameImpl##appliedRootValue` | web/frames | 3 | R | R.version |
| `FrameImpl##element` | web/frames | 3 | T | T.store |
| `FrameImpl##end` | web/frames | 3 | T | T.store |
| `FrameImpl##have` | web/frames | 3 | F | F.live |
| `FrameImpl##options` | web/frames | 3 | T | T.store |
| `FrameImpl##slots` | web/frames | 3 | T | T.slots |
| `FrameImpl##start` | web/frames | 3 | T | T.store |
| `FrameImpl##version` | web/frames | 3 | R | R.version |

### A.2 `page: base` — the frames / sf units not on the frames scenario (36 units, 8,148 B)

The 267 frames + sf-slice units shared with the frames scenario are byte-for-byte within ±25 B of A.1 on page base (external bindings are imported under one-letter aliases on the package scenario); they are not repeated. Serialization ships as the lazy `decode.js` chunk (22,986 / 6,074) and has no eager unit.

| unit | module | min B | class | group |
| --- | --- | --: | --- | --- |
| `dispatchServerFunction` | web/server-functions | 1198 | T | T.refs |
| `createRequest` | web/server-functions | 906 | T | T.refs |
| `initializeResponse` | web/server-functions | 688 | T | T.refs |
| `getHeadersAndBody` | web/server-functions | 669 | T | T.decode |
| `extractBody` | web/server-functions | 653 | T | T.decode |
| `isJSONSafe` | web/server-functions | 647 | T | T.decode |
| `serverFunctionFailure` | web/server-functions | 435 | T | T.refs |
| `serializeArguments` | web/server-functions | 415 | T | T.decode |
| `GET.send` | web/server-functions | 347 | T | T.refs |
| `GET` | web/server-functions | 209 | T | T.refs |
| `siblingAddressFor` | web/server-functions | 180 | T | T.refs |
| `parseRetryAfter` | web/server-functions | 168 | T | T.refs |
| `GET.run` | web/server-functions | 159 | T | T.refs |
| `createServerReference.run` | web/server-functions | 138 | T | T.refs |
| `withMeta` | web/server-functions | 123 | T | T.refs |
| `createServerReference` | web/server-functions | 92 | T | T.refs |
| `localOrSend` | web/server-functions | 90 | T | T.doc |
| `serverFunctionDataAddress` | web/server-functions | 90 | T | T.refs |
| `serverFunctionLiveAddress` | web/server-functions | 90 | F | F.live |
| `serverFunctionAddress` | web/server-functions | 85 | T | T.refs |
| `decodeResponse` | web/server-functions | 82 | T | T.decode |
| `isReadCall` | web/server-functions | 74 | T | T.refs |
| `dispatchServerFunction.[Symbol.asyncIterator]` | web/server-functions | 66 | T | T.refs |
| `createServerReference.get` | web/server-functions | 62 | T | T.refs |
| `getServerFunctionMetadata` | web/server-functions | 60 | T | T.refs |
| `provideRPC` | web/server-functions | 57 | T | T.refs |
| `createServerReference.run.send` | web/server-functions | 57 | T | T.refs |
| `dispatchServerFunction.[Symbol.asyncIterator].return` | web/server-functions | 56 | T | T.refs |
| `adoptedCall` | web/server-functions | 52 | T | T.doc |
| `isServerFunction` | web/server-functions | 52 | T | T.refs |
| `provideServerFunctionRPC` | web/server-functions | 50 | T | T.refs |
| `dataAddressFor` | web/server-functions | 25 | T | T.refs |
| `GET.get` | web/server-functions | 25 | T | T.refs |
| `dispatchServerFunction.[Symbol.asyncIterator].next` | web/server-functions | 18 | T | T.refs |
| `createServerReference.fn` | web/server-functions | 15 | T | T.refs |
| `GET.wrapped` | web/server-functions | 15 | T | T.refs |
