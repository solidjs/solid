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

_Status: complete (2026-10-06). Every number marked measured was read from an edited dist copy through the harness's own bundler; estimates are marked._

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

| class | by whole unit | share | residue re-attributed | share | **br, measured** (§2: each class removed from an edited dist copy) | share of br |
| --- | --: | --: | --: | --: | --: | --: |
| **T — transport** | 26,879 | 62.1 % | 21,479 | 49.6 % | **7,227** (the floor, `L8`) | 52.5 % |
| **R — restates core** | 5,080 | 11.7 % | 6,655 | 15.4 % | **1,863** (`noD` − `TF`, every feature kept; 1,701 when removed last, `L7` → `L8`) | 13.5 % |
| **F — feature** | 10,615 | 24.5 % | 13,035 | 30.1 % | **4,362** (`TF` − `L8`; 5,000-odd when removed first, §2.1) | 31.7 % |
| **D — dead / incidental** | 736 | 1.7 % | 2,141 | 4.9 % | **318** (`L0` − `noD`) | 2.3 % |
| total | 43,310 | | 43,310 | | 13,770 | |

"By whole unit" assigns each function to one class; "residue re-attributed"
moves the bytes a unit carries for another class (the live arms of
`chunkToRecords`, the `_s:` branch of `collectSlots`, the gate half of
`adoptBoundary`, the `#2968` arm of `#syncSlots`, …) to that class. The
second column is the honest one; the first is the one a reader can check
against a function name. The minified deltas §2 measures by actually
deleting a class run ≈ 10–15 % above the residue-adjusted attribution (a
deleted function takes its call sites and its share of the minifier's name
table with it); brotli is measured, never estimated, except where marked.

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

### 2.1 Method

The floor is an **edited dist copy**, not a rewrite: `tmp-tools/floor.py`
applies group-tagged cuts to a copy of `packages/web/frames/dist/client.js`
(the readable Rollup output, 2,605 lines), each cut an exact-string
replacement that asserts its anchor matches once, and `tmp-tools/measure.mjs`
bundles the scenario with the copy in place of the dist (`--dist frames=…`).
A group's cut deletes its functions **and** their call sites, and where the
group restates the core it is replaced by the minimal call into the core,
not by nothing. Every variant parses (`node --check`) and carries no
dangling identifier (verified by grep over every removed name); the
resulting T-only file is 1,245 lines and reads as the client it describes.
The variants are cumulative layers (`L1`–`L8`), the full client minus one
group, and the floor plus one group (§3). The baseline `L0` reproduces the
harness to the byte (43,310 / 13,770).

| layer | removes | min B | br B | Δ min | Δ br |
| --- | --- | --: | --: | --: | --: |
| L0 | — (as shipped) | 43,310 | 13,770 | | |
| L1 | F.live | 39,781 | 12,729 | −3,529 | −1,041 |
| L2 | F.bind | 34,606 | 11,191 | −5,175 | −1,538 |
| L3 | F.trace | 33,485 | 10,868 | −1,121 | −323 |
| L4 | F.regions | 31,162 | 10,244 | −2,323 | −624 |
| L5 | F.assets | 28,750 | 9,571 | −2,412 | −673 |
| L6 | F.claims + F.event | 27,817 | 9,230 | −933 | −341 |
| L7 | D | 26,609 | 8,928 | −1,208 | −302 |
| **L8** | **R → T-only** | **21,297** | **7,227** | **−5,312** | **−1,701** |

The measured deltas run ≈ 10–15 % above §1's per-unit attribution for the
same group (F.bind 5,175 measured vs 4,508 attributed; F.live 3,529 vs
3,522; F.regions 2,323 vs 1,393 + the thread-up protocol's inlining; R
5,312 vs §1.2's "deletable now" ≈ 4,700): deleting a function also deletes
the call sites §1 charged to its callers, and the minifier's name table
shrinks. §1 is the attribution; §2 is the cost.

### 2.2 What the T-only client is

**21,297 B minified / 7,227 B brotli** on the frames eager-client scenario —
**573 B under the §6 budget read as brotli** (7,800), and ≈ 7,950 B min+gzip
against §6's own unit. Composition (`fnmap` over the floor): the frames
client 17,261, the retained sf slice 3,765 (unchanged — `ChunkReader`,
`stableString`, `deserializeStream`, `deliverFlightData`, `createChunk`,
`errorFromTrailer`, …), import statements 271; 178 units. The largest:
`reconcileChildren` 829, `stableString` 601, `ChunkReader#next` 558,
`slotsFor.get` 513, `chunkToRecords` 506, `#syncSlots` 466, `#flush` 463,
`applyFrames.drain` 461, `deserializeStream` 446, `installServerComponents`
397, `claimRender` 364, `applyFlightResponse` 357.

It still imports `getOwner, onCleanup, createMemo, runWithOwner,
createSignal, createRenderEffect, createOwner, untrack` from `solid-js`,
`insert` from `@solidjs/web`, `createLoadingBoundary, sharedConfig` from
`solid-js/internal`, and ten names from the sf client; it exports
`FRAME_STREAM_HEADER, applyFrameResponse, asyncArg, createFrame,
createFrameElement, createFrameHost, createServerComponentHandler,
getFrameHost, installServerComponents, isFrameStreamResponse`
(`FRAME_APPLIED_EVENT`, `FRAME_HAVE_HEADER`, `FRAME_HAVE_BUDGET` leave with
their features — **public surface**, flagged).

What it does, and how the core carries the async half:

- **Fetch → address → binding.** `handle` resolves a frame-tagged response
  to `bindingFor(frameAddress(id, args), id)` at the header and streams the
  body into the address's store under one client-stamped version per
  response (`bump`); a single-flight response decodes its envelope and
  writes its regions' frames the same way. No staging: a refetch's chunks
  land as they arrive (the Transaction's staging of the whole landing is
  the address-source seam, §5 S-flush).
- **Store → frame.** `createFrameHost.write` is the one version guard, in
  the 1.4-full form (a newer version replaces the address's records
  wholesale); `FrameImpl#apply` is `Object.assign(store, write.r); flush()`
  — no frame-side version, no `rebase`, no reset site, no dedupe. The root
  applies when its **record** changes (not its value), so a byte-identical
  root under a new version applies (C7 (c) unrepresentable).
- **The first flush is one async value.** `boundaryComponent` returns
  `createMemo(() => first.then(() => element))` where `first` is a promise
  resolved by the frame's first `onApply` (content or error) — the enclosing
  `<Loading>` pends on it through the core (`handleAsync`), nothing else
  gates. A warm store (no stream begun) returns the element directly. A
  switch is `createRenderEffect(() => binding(), address =>
  frame.rebind(address))` — the site → address pull in the effect half, no
  re-arm, no frameless waiter: the display is holds-latest (ruling 1.6
  (ii)); (i) needs the per-address half of S-flush.
- **Segments.** `#flush` re-asks every flush: a `seg:<k>` with its
  `seg:<k>:reveal` record and its placeholder in range reveals — through
  the reveal seam's `createLoadingBoundary` (the fills' own async is
  covered) — and the swap removes the template, so the DOM is the state
  (no `#revealed`); a `seg:<k>:fallback` materializes the template's
  content once (`tpl._$fl`, as `$dfl` marks it). The retry loop stays (a
  reveal can insert another segment's placeholder); the style gate is gone
  with assets.
- **Fills.** `#syncSlots` discovers `slot:<id>` marker pairs, mounts each
  occurrence once through `slotsFor` — `evaluate` under `claimRender` when
  adopted, then **always** `insert(end.parentNode, value, end,
  [...existing])`: the core's own fill, claim pass under hydration, no
  static path — and on a re-sent record pushes `#resolveArgs(record.args)`
  into the live fill (`liveSlotProps` → `slotArgsProxy`); the fill's props
  carry the equality. A `{$ref}` not yet delivered still skips the apply
  (`#refsUnresolved` kept — the pending-ref read is seam S-ref).
- **Document face.** `installServerComponents` installs `_$SC.impl` (the
  document bootstrap is the one copy), `intercept` answers a call locally
  when the page has the unclaimed element and defers through `arrivals`
  when a fragment may still deliver it; `adoptBoundary` drains the page's
  `sc:slot:<fid>:*` records into the address's store as **one write** at
  adoption and on every ledger reveal, binds an adopting frame over the
  element and hands hydration the node. No `#2968` defer, no
  `claimRegionFragments`, no switch gate.
- **Morph.** `reconcileChildren` and its helpers unchanged (A7,
  identity-first), minus the claim thread and the text-pair arm.

### 2.3 What it cannot do

Every F capability is gone — the user-visible loss per tier (§3 adds each
back):

| gone | what the user loses |
| --- | --- |
| F.live | no live/GET re-emission: holes and attr holes never update after the first flush; no reconnect with a have-list (every reconnect is a full snapshot — today's post-adoption connect already is); the document live channel (`sc:live`) is not pumped. A page that uses `live()` gets the loop's reconnects but each lands as a full morph. |
| F.bind | no binding/attribute slots: `_s:` positions in server markup never bind — attributes, class/style and text positions stay at the server's values, inert. |
| F.trace | no container traces: a live store passed as a slot arg arrives as an inert marker object (the fill reads `{$tr: …}`); on a page this also drops the 31 KB store engine + adapters the eager install pulls (page base −13.9 KB br). |
| F.regions | no `{$frame}` regions: server content as a prop to a client fill cannot be rendered (the fill receives the raw `{$frame}` ref); occluded regions cannot mount from the store. |
| F.assets | **no CSS for streamed segments**: a segment whose `assets` record names stylesheets reveals without loading them (not FOUC — the sheet never loads; the document face keeps the core's `$dfs`, the stream face has no carrier); no typed preloads, no module preloads, inline styles not applied. |
| F.claims / F.event | router link-state claims (`a[href]`, `form[action]`) on server markup do not run; no `frame:applied` (scroll restoration, affordance reflection). |

And the holes the T-only client has that the full client does not — the
**new gaps** the contract analysis found (G1–G9), with what closes each:

| gap | severity | what closes it |
| --- | --- | --- |
| **G2/G3 — a late record never wakes its fill; the hold is not a boundary resume.** Without the `#2968` defer, a `prop#n` occurrence whose record script runs after the adopt-time sync is classified recordless and evaluated argless (the C18 `TypeError`); with a "mount and pend" in its place the resumed fill runs outside `claimRender`'s window and renders fresh clones over server DOM (C1/C9 regress). | **page-halting / wrong content** | the bounded `prop#n` poll (+323 min / +105 br, measured as `Tglue`) until S-hold + S-record exist (§5) |
| **G4 — post-done inner reveals held.** `fragmentPolicy` holds an unclaimed swap after hydration-done; `claimRegionFragments` was the claimant for server-only `<Loading>`s. | wrong content (frozen fallback) | the solid seam S-adopted (+80 B solid) or the 6-line claim (+153) |
| **G6 — a document reveal does not sync the frame** (ruling 2.3): a fill revealed by a `$df` into adopted content mounts only when some later flush happens. | wrong content (inert) | the `fr.subscribe` → `frame.sync(parent)` one-liner (+58 min / +23 br, measured as `Tglue-reveal`) |
| **G7 — a refetch inside an action tears** (C15): the first flush is held by the transaction through the memo, later chunks morph outside the graph. | wrong content (transient) | S-flush (the address source; the Transaction then stages the landing) |
| **G1 — no re-pend on a switch**: the enclosing `<Loading>` does not re-pend when the address switches; the site shows the previous content until the new address's first morph (holds-latest, 1.6 (ii)). | flash-class (display rule change, not a bug) | the per-address half of S-flush for 1.6 (i) |
| C5 — `data` chunks bypass the version guard (`host.apply`'s data arm), so a superseded response's late `data` still lands in the current table. | wrong values under a refetch race | the per-response data cell (frames-rulings 1.2, ≈ 140 B, shared with S-ref) |

The **honest floor** is therefore `Tglue`: T-only + the reveal→sync
one-liner + the bounded `prop#n` hold — **21,620 B min / 7,332 B br**, 468 B
under the budget — with G4, G7, G1 and C5 as the seams §5 names. The
version of the floor with every seam built and every R residue gone
(R.claim ≈ 470, R.refwait ≈ 145, the sf slice's live arm ≈ 150) lands near
**≈ 20,800 min / ≈ 7,000 br** (estimated).

### 2.4 The contract's reds under T-only

For each of the twenty-two `test.fails` on `next` (and the green set):
**unrepresentable** = the mechanism that produced the red is gone and the
core's rule decides; **holds by core** = carried by a core primitive, gated
on the named seam; **still red**; **feature gone** = vacuous.

| red | T-only verdict | why |
| --- | --- | --- |
| **C2 (a2)** record after reveal; **C2 (b)** direct-insert revealed; **C2 replay** | holds by core — with the one-liner (`Tglue-reveal`) and S-record | the reveal syncs the revealed range; a bare `children` mounts there (b); a `#`-named occurrence found recordless waits for its record (a2) — today through the bounded poll, under S-record through a pending read. Without the one-liner: still red (inert). |
| **C3 (a)** done while a record is deferred; **C3 replay** | holds by core — with S-hold | the hold registers through `initBoundaryResume` and `checkHydrationComplete` waits (corollary 3). In `Tglue` as built the poll registers nothing: **still red** until S-hold. |
| **C4 (d)** drain before reveal | **unrepresentable** | no `appliedRecords`-consumed-then-never-applied path: the record is in the store, and the reveal's sync (one-liner) finds the marker pair; the ledger is the store (corollary 2). |
| **C5 (a, b, e)** a superseded response's late `data` | **unrepresentable — conditional** | L2 ruling 5: a landing asking an older question is dropped. Holds once `data` goes through the per-response cell (1.2, ≈ 140 B); in the floor as built the data arm still bypasses the guard, so these three are **still red** until the cell. |
| **C6 (a1)** switch during a `{$ref}` wait | holds by core — with S-ref | no `clearStreamRecords` keep-`slot:*`, no `#refsUnresolved` re-route: the rebind seeds B's store wholesale and the fill's args re-derive at B's record; a read pinned to A's table pends (S-ref). Without the pin: reads B's table — the C6 shape — **still red**. |
| **C6 (b2)** refetch during the wait | **unrepresentable** | no staged commit installs v2's tables under v1's held read; v2 replaces wholesale (1.4 full). |
| **C7 (c)** byte-identical v2 root never re-applies | **unrepresentable** | the root applies by record identity; every landing applies (A30). |
| **C12 (c)** rejected server `<Loading>` blanks | **still red — server half** | A0 withdraws the pin's expectation (frames-rulings 3.3): the client shows what the server rendered (the blank `" "`); the fix is the sink's error markup. Post-done the swap is held (G4) rather than blank until S-adopted. |
| **C13 (a, b)** one sweep, two frames | **feature gone** | the live channel and hole chunks are removed; if live returns the red returns, and it is the server half's (a wire delimiter). |
| **C17 (a)** A's late html after the switch | **unrepresentable** | no gate to answer wrongly: A's chunks land in A's warm store after the rebind and reach no frame; the site shows A until B's first morph (holds-latest). |
| **C17 (c)** A's html while B's header pends | **pin changes** | A was the bound address when its html landed, so the frame shows A, then B morphs in — `waiting → A → B`, ruling 1.6 (ii) as display behaviour. (i) (`waiting → B`) needs the per-address half of S-flush. |
| **C18 ×1** two records after the parser's end | **unrepresentable** | no per-record drain to lag the ledger (one write per drain), and `#` decides the class: a `prop#n` found recordless is a pending read, never direct-insert. |
| **C18 ×2** a live op before the drain, the pump's catch-up | **feature gone** | live removed (and the per-record drain is gone regardless). |
| **C19 ×2** a patch lands before the claim | **feature gone** | traces removed; no other arg kind moves between SSR and claim (`s`/`v` stamps carry the rendered value). |

Counts: **7 unrepresentable** (C4 d, C5 ×3 conditional on the cell, C6 b2,
C7 c, C18 ×1), **8 hold by core** — every one gated on a seam that does not
exist today (C2 ×3 on the one-liner + S-record, C3 ×2 on S-hold, C6 a1 on
S-ref, C17 a unconditional, C17 c a pin change), **1 still red** (C12 c,
the server half), **6 feature gone** (C13 ×2, C18 ×2, C19 ×2). The green
set (C1, C8, C9, C10, C14, C16) stays green with two conditions: C1/C9/C10
need the adopt-time hold to stay a *deferred mount* with hydration re-entry
(S-hold, not a bare counter), and C8/C14 (c) need the per-flush segment
check the floor keeps. C6 (b1)'s pin asserts the opposite of A0 (it expects
v1's late data to show after v2's header) and inverts. C11 and C15 go
vacuous with their features.

---

## 3. Tiers

Each F group's cost two ways: **eager** = added back onto the T-only floor
(measured; the honest number for "what does the default build cost if it
ships this"), and **in the full client** = the full client minus the group
(measured; what today's bundle pays for it). The two differ by the
minifier's context (≈ 5 %). Lazy-on-use = the group as its own chunk plus
the seam that detects the key and holds (the S1 shape: seam D's
server-recorded "this document needs X" + a pending-boundary registration
at the claim), estimated from S1's measured seam (≈ 100–300 B min) and the
rulings' 3a (+125 min / +35 br).

| tier | eager, on T (Δ min / Δ br) | in the full client (Δ min / Δ br) | lazy on use: chunk (min / ≈ br) + eager seam | server-known key | behaviour change when lazy (§5.2) |
| --- | --: | --: | --- | --- | --- |
| **E.a live** (F.live) | +3,500 / **+1,064** | −3,529 / −1,041 | ≈ 3,400 / ≈ 1,000 + ≈ 150 / 45 | the response or document carries holes, attr holes or `sc:live` | none on screen: holes buffer in the store until the tier's flush; the pump starts after the load |
| **E.c binding slots** (F.bind) | +5,064 / **+1,546** | −5,139 / −1,539 | ≈ 4,900 / ≈ 1,450 + ≈ 200 / 60 | `_s:` markers in the document or response | a post-load stream's first binding waits one chunk load (audit §7 Q5, accepted for B.3); the adopt-time sync holds on it (S1 class) |
| **assets** (F.assets) | +2,376 / **+684** | −2,417 / −665 | ≈ 2,300 / ≈ 650 + ≈ 100 / 30 | an `assets` chunk / a style-gated fragment | a segment with stylesheets is not ready until the tier loads (one term in `#segmentReady`) — or route the group through `web`'s own loader via `client.ts`'s import edge (audit S10) and the mirror's ≈ 750 B of untested code goes instead |
| **regions** (F.regions) | +1,873 / **+489** | −2,344 / −627 | ≈ 1,800 / ≈ 470 + ≈ 150 / 45 | `{$frame}` refs in a record / `data-fid` region elements | an occurrence whose record names a region holds until the chunk loads (S1 class, adopt path) |
| **N container traces** (F.trace) | +1,023 / **+289** (+ on a page the 31 KB engine, B.2) | −1,121 / −317 | S1 built it: the materializer behind `prepareArgs` ≈ 700 eager → ≈ 150 + the engine lazy | a serialized trace in the document | S1's hold (`#heldRecords`, pinned) |
| **claims + event** (F.claims, F.event) | +922 / **+331** | −921 / −346 | not worth a seam (≈ 0.9 KB); ship with the router's tier if one exists | the router installed `CLAIM_SEAM` | a sweep before the tier loads misses the first morph's anchors; the router re-sweeps on install |
| **staging** (the #3759 capability) | — (R; its carrier is deleted; the capability returns through S-flush: ≈ +120 buffer + ≈ 80 node, ≈ +200 / +60) | the carrier was ≈ 2,072 attributed | n/a — it is the Transaction's staging once the node exists | — | none: the capability is restored, not tiered |

Compositions the maintainer may want as a default build (all measured,
frames eager, min / br; budget 7,800 br):

| build | min | br | vs budget |
| --- | --: | --: | --: |
| T-only (`L8`) | 21,297 | 7,227 | −573 |
| T + reveal one-liner + bounded hold (`Tglue`, the honest floor) | 21,620 | 7,332 | −468 |
| T + assets | 23,673 | 7,911 | +111 |
| T + regions | 23,170 | 7,716 | −84 |
| T + assets + regions | 25,546 | 8,394 | +594 |
| T + assets + regions + claims | 26,468 | 8,727 | +927 |
| T + assets + regions + claims + trace | 27,478 | 9,020 | +1,220 |
| T + assets + regions + claims + live | 29,976 | 9,797 | +1,997 |
| T + live + bind | 29,821 | 9,822 | +2,022 |
| T + live + bind + assets | 32,197 | 10,470 | +2,670 |
| T + live + bind + assets + regions | 34,089 | 10,976 | +3,176 |
| **T + every feature, R and D deleted** (`TF`) | **36,004** | **11,589** | **+3,789** |
| as shipped (`L0`) | 43,310 | 13,770 | +5,970 |

Page base (the whole page, lazy `decode.js` 22,986 / 6,074 not counted):
`L0` 145,569 / 44,823 → `TF` 138,240 / 42,776 (−2,047 br: R and D off the
page with every feature kept) → `Tglue` 96,276 / 30,968 → `L8` 95,953 /
**30,901** (−13,922 br: the T-only client **and** the store engine +
adapters the trace tier pulled — the SC audit's B.2 falls out of the trace
tier rather than needing its own seam).

---

## 4. Verdict

**How the 3× splits.** Of the 13,770 B br shipped, measured in the frames
eager-client scenario by removing each class from the bundle: **T 7,227
(52 %)**, **F 4,362 (32 %)**, **R 1,863 (13.5 %)**, **D 318 (2.3 %)**. Of
the **5,970 B over the 7,800 budget**: R + D are **2,181 (37 %)** —
deletable under A0 with no product decision, and every feature kept; F is
**3,789 (63 %)** — a product decision about which capabilities ship eager.
(The ratio itself: 13,770 br is 1.77× the §6 figure read as brotli, ≈ 2×
read as §6's own min+gzip; the "almost 3×" is against a target this
document could not locate — the arithmetic here is against §6.)

**Second-model problem or scope problem?** Both, in that order of size
reversed from what the audit assumed. The second model is real and worth
**≈ 1.9 KB br / ≈ 6.1 KB min** (measured, every feature kept: `noD` − `TF`)
— plus ≈ 0.3 KB br of dead code — and deleting it alone lands the
full-featured client at **11,589 B br, 1.49× budget, 3,789 B over**. So
**deletion does not close the gap**; it closes 37 % of it. The rest is
scope: the frames client ships five capabilities eagerly — live/GET
re-emission (1.06 KB br), binding slots (1.55), the asset mirror (0.68),
regions (0.49), container traces (0.29), the router contract (0.33) — none
of which the transport needs and each of which has a server-known key to
load it on use. **A T-only frames is 7.2 KB br, under the budget**; T plus
the two features closest to the transport (regions and stylesheets for
streamed segments) is **8.4 KB, 594 B over**; T plus everything but live
and binding slots is 9.0 KB; T plus everything is 11.6 KB.

**Plainly:** if the maintainer wants binding slots and live eager, the
default build **cannot** meet 7.8 KB br even with every A0 deletion made —
T + live + bind alone is 9,822 B (+2,022), and with assets and regions
10,976 (+3,176). The budget is reachable only by a tiered default: T (plus
the two small glue seams) eager at ≈ 7.3 KB, regions and assets eager if
wanted (≈ 8.4 KB — the budget would need to move to ≈ 8.5 KB, or assets
routed through `web`'s loader instead of mirrored), and live, binding slots
and traces loaded on their server-known keys. The audit's §7 Q7 ("replace
the §6 budget with per-tier budgets") is the question this measurement
answers in numbers.

**Against the SC audit's §6.1 floors** (frames eager, br): P packaging only
≈ 12.3 KB; C carve only ≈ 11.5; P + C′ ≈ 10.5. Those were the right answers
to a different question — they kept every feature eager (P tiers only
E.a/E.b/E.c, and only estimated) and classified by "does a frames ruling
require it". A0 changes three things: (1) the staging carrier (≈ 2.1 KB
min), the shell gate (0.7), the static fill path (0.6), the two dedupes
(0.9), the frame's version space (0.5), the range-scoped claim registry
(0.5) and the reveal-readiness model (0.5) move from *structural* to
*restates core* — the audit's C′ deleted ≈ 1.8 KB br of incidental seams;
A0's R is ≈ 1.9 KB br and overlaps C′ only in the dedupes, the gate twin
and the version space; (2) the full-featured A0-cleaned client is **11.6 KB
measured**, close to the audit's C-only estimate (11.5) but by deletion
rather than rewrite — no engine change, no wire change; (3) the audit's
P + C′ floor (10.5) is reached and passed by **tiering**, not packaging:
T + live + bind + assets is 10.5 KB measured, and T + assets + regions is
8.4. The audit's B.2 (the store engine off the page, −7.7 KB br on page
base) is a consequence of the trace tier, not a separate seam.

**What this costs elsewhere.** The R deletions need core seams the brief
asked to be named (§5): ≈ 150–200 B in `solid-js` (S-hold's
`hydrateWindow` + the `initBoundaryResume` reach ≈ 40–65, S-adopted ≈ 80,
`whenRevealed` ≈ 15, `readHydratedValue` ≈ 10) paid by every hydrating
page (≈ +50 br), ≈ 60 B in the lazy decode chunk (S-ref), and two server-half
items (a declared slot record, a fragment key on the SC reference, each ≈
+30 B of output). S-flush — the one that makes staging the Transaction's
and 1.6 (i) by construction — is ≈ 110–190 B in frames and 0 in signals.
Nothing in §2 or §3 changes the wire.

---

## 5. Open questions

### 5.1 R units whose removal needs a core seam that does not exist yet

Each names the seam, where it lives, and its likely cost. "Frames" means
the glue lives in the frames client and costs the frames scenario; "solid"
/ "signals" means every hydrating page pays it.

| seam | removes (frames, min) | what it is | where, cost (est.) |
| --- | --: | --- | --- |
| **S-flush — the address source.** One reactive node per bound address written at the response's landing (`content = createMemo(() => host.landing(binding()))`); the enclosing `<Loading>` pends on it, a switch is a new flight on it (supersession by `_inFlight !== result`), a refetch's landing is staged by the transaction that read it. | R.gate ≈ 550 of 674; R.stage ≈ 1,300 of 2,072 (the `preview` half, the token/table machinery) | The core has the node shape (`core/async.ts:handleAsync`'s thenable and async-iterable branches, `_inFlight` supersession; `scheduler.ts` staging) and `dynamic`'s value memo is already "the ordinary async memo the boundary waits on" with provenance (`token === latest`, `web/src/index.ts:452`). What is missing is the **resolution point**: the handler returns the binding at the response **header** (`frame-transport.ts:882–908`); nothing resolves the call at the version's first root/error write. The floor's glue (§2) is the mount-time half of this seam (a promise resolved at first apply, ≈ 110 B); the per-address half (re-pend on a switch, the staged landing of a refetch) is the seam proper. | **frames**, ≈ 110–190 B (the host's `firstWrite`/`landing` + the memo); **0 in signals**. Changes C17 (c) to ruling 1.6 (i) by construction, and makes C15's atomic refetch the Transaction's own staging (G7 closes). |
| **S-hold — the frame's hold is a boundary resume.** A recordless `prop#n` occurrence at adoption defers its mount (as today) but registers through `initBoundaryResume` and resumes through `resumeBoundaryHydration`'s window, so hydration-done counts it (3.1, ruled) and the resumed fill still claims under the producer's keys. | R.drain ≈ 270; R.claim ≈ 470 | `initBoundaryResume` (`hydration.ts:2574`) is not exported and is keyed by a hydration id with an `_fr`/serialized record; `resumeBoundaryHydration` (2487) carries `captureBoundaryScope` so a late resume re-enters hydration with the captured registry. "Mount and pend at the read" instead of "defer the mount" would run the fill's re-run **outside** `claimRender`'s synchronous window and render fresh clones over server DOM (C1/C9 regress) — the counter alone is not the seam; the window is. | **solid**: an internal `hydrateWindow(id, fn, roots?)` factored out of `resumeBoundaryHydration` + `initBoundaryResume` reachable from the adopter (`sharedConfig.resumeBoundary` or an `internal` export) ≈ +40–65 B (≈ +12–20 br on hydrating pages — frames-rulings 3a estimated +25); **frames** ≈ +100 for the registration at the sync's end. |
| **S-record — a late record wakes its reader.** `_$HY.r[k] = …` is a plain write (`server.ts:2242`); the only wake-up today is `#recordRefresh`'s `setTimeout` poll. | R.drain's poll ≈ 120 (the part S-hold alone does not remove) | Two shapes: (a) **server half** — the document sink writes `sc:slot:<fid>:<occ>` as a **declared** pending ref at the marker (as `registerFragment` writes `<id>_fr`, `server.ts:2850`) and settles it with the args, so `readHydratedValue`'s `.then` path (`hydration.ts:484–485`) carries the wait; (b) **solid** — a write hook on `_$HY.r` in the document runtime. (a) is the A5 shape and costs ≈ +30 B of sink output per record; (b) ≈ +40 B in solid. Without either the client keeps a bounded poll. | **server** ≈ +30 B/record or **solid** ≈ +40 B |
| **S-ref — a pending ref read.** The codec table answers an undelivered `{$ref}` with a pending promise, rejected at `complete`/`:error` (L1), and a record's refs resolve through the table object current at the record's apply (frames-rulings 1.2's per-response cell). | R.refwait 145; part of R.stage (`stageTables` 183 → a cell ≈ 140) | `tableFor(id)?.resolve(ref)` returns `undefined` for an undelivered key (`client.ts:149–153`), and `tables` is rotated in place by address (`beginStream`), so a lookup re-run after a rotation reads the next response's table (the C6 shape). | **decode chunk (lazy)** ≈ +60 B for pending-on-missing + **frames** ≈ +40 B reject-at-complete + the cell ≈ 140 (replacing `stageTables`). Fixes an L1 hole (a ref whose data never comes is silent today). |
| **S-reveal — a document reveal syncs the frame.** The document face's reveal is the hydration ledger's `$df`, not a store write; `#flush` never sees it (frames-rulings 2.3, DR-4). | — (the `fr.subscribe` one-liner stays in the floor) | Interim: `fr.subscribe((_, parent) => el.contains(parent) && frame.sync(parent))` ≈ 70 B (the rulings' 2b). Structural (DR-4, 2c): the document fragment as a write into frame `""`'s store — its own plan, ≈ 1.3 KB on whichever side goes, **and** A0 reverses DR-4's direction (the document runtime's inline `$dfr` cannot be the engine for a CSR-booted page that streams a frame; a module copy in solid is ≈ 500 B min on every hydrating page). | **frames** ≈ +70 B interim |
| **S-adopted — the ledger knows an adopted frame owns its range.** `fragmentPolicy` holds unclaimed swaps after `_hydrationDone` (`hydration.ts:2663`); `claimRegionFragments` is the per-`pl-*` workaround. | R.claimant 153 | `_adoptedRoots: Set<Element>`; `fragmentPolicy` swaps when `getElementById("pl-" + id)` is inside an adopted root; `fr.adopt(el)`/`fr.unadopt(el)` ≈ 30 B in frames. | **solid** ≈ +80 B (≈ 0 cost while the set is empty) |
| **S-key — the fragment that delivers a boundary element.** `installRevealHook` rescans the revealed parent on every reveal because the ledger cannot name which fragment carries a given `<solid-frame>`. | T.doc ≈ 250 of `installRevealHook` 354 + `indexBoundaries` | The SC reference / placeholder carries its covering fragment key (≈ +30 B server), and `whenRevealed` (`hydration.ts:2747`, **not exposed** on `_$HY.fr`) is published (≈ +15 B solid); both waiters become `whenRevealed(key).then(...)` ≈ 100 B. | **server** ≈ +30 B, **solid** ≈ +15 B |
| **S-swap — a module `$dfr`/`$dfl`.** Only if the maintainer wants one reveal engine with the document runtime as the owner (A0's direction, the inverse of DR-4's). | R.reveal ≈ 270 (the retry loop and the rest of `#segmentReady`), the DOM half of the swap ≈ 400 (T today) | `hydration.ts` carries the swap mechanics exposed as `_$HY.fr.swap(id, root?)`/`fallback(id, root?)` with a range scope (fragment keys collide across frames under the default `renderId` — or the server half prefixes frame-stream keys, ≈ +20 B). | **solid** ≈ +500 B min / ≈ +150 br on every hydrating page — a bad trade for the non-SC page; not recommended |
| `readHydratedValue` exported from `solid-js/internal` | R.error ≈ 50 | the frames copy lacks the #2997 rejection-observe | **solid** ≈ +10 B |

### 5.2 F groups whose lazy load would change behaviour (the S1 hold class)

| group | lazy key (server-known) | what changes when loaded on use |
| --- | --- | --- |
| **F.bind** (E.c) | the document or response carries `_s:` markers | a page whose first binding-slot markers arrive in a **post-load stream** (not the document) takes a chunk load before the fill binds — the fill's positions sit at the server's values meanwhile; the same accepted change B.3 makes for CSR `dynamic` (audit §7 Q5). A document-face page preloads it through seam D and sees no change. A hold (the S1 class): the adopt-time sync must **wait** for the chunk before classifying a `_s:` occurrence, and that wait registers as a pending boundary (3.2) — the `prepareArgs` shape S1 built for traces. |
| **F.live** (E.a) | the server emitted holes, attr holes, or `sc:live` for this document/response | a hole or attr chunk that arrives before the chunk loads must **buffer** (the store already does — records stay pending until a flush can apply them, so the load seam is "await the tier, then flush"); the document channel's pump starts after the load — ops before it are in the stream's buffer, not lost. No hold on hydration-done is needed (holes are post-first-flush updates, not the frame's first value). The tier key cannot be `live()` (the document channel is reachable without it — audit §7 Q4). |
| **F.trace** (N) | the document serialized a container trace | the S1 class exactly: a fill whose arg is a trace marker holds until the materializer (and the store engine behind it) loads; S1 (`size/s1-lazy-store-materializer`) built the hold (`prepareArgs`, `#heldRecords`) and pinned "the mount claims before done" under 3.1. Already designed; ≈ 100–300 B seam. |
| **F.regions** | the document or response carries `{$frame}` refs / `data-fid` region elements | an occurrence whose record names a `{$frame}` must wait for the chunk before `#resolveArgs` can hand the fill a region element — a hold of the S1 class on the adopt path (register as a pending boundary); on a stream, the record stays pending in the store until the load's flush. |
| **F.assets** | the response carries an `assets` chunk / the document a stylesheet-gated fragment | a segment whose `assets` record names stylesheets must not reveal before the loader is resident — the reveal's readiness test must treat "tier not loaded" as not ready (one term in `#segmentReady`). No behaviour change beyond the extra latency; the stylesheet's own load dominates. |
| **F.claims / F.event** | the router is installed (`CLAIM_SEAM` present) | a claim sweep that runs before the tier loads misses the first morph's anchors — the router would re-sweep on install, as it does for CSR content. Small enough (≈ 0.7 KB) that a tier is not worth its seam. |

### 5.3 For the maintainer

1. **The `{$ref}` wait is an L1 hole today** (§1.2, R.refwait): a record whose
   data never arrives is never applied and nothing reports it. The A0 form
   (S-ref) fixes it; confirm that is wanted before it is counted as a byte
   saving.
2. **The `#2968` defer over-applies** (§1.2, R.drain): the sink names every
   called occurrence `prop#n`; a bare `prop` is direct-insert by design.
   Scoping the defer to `#`-named occurrences removes the ambiguity C18
   turns on and the latency the defer imposes on direct-insert content —
   independent of A0, and worth doing before S-hold.
3. **C6 (b1)'s pin asserts the opposite of A0**: it expects v1's late `data`
   to *show* after v2's header; L2 ruling 5 forbids it. The invariant is
   green under A0 and the pin is red — re-pin with the step that builds
   S-ref.
4. **C12 (c)'s expectation is withdrawn by A0** (frames-rulings 3.3) and its
   fix is the server half's; no client class carries it.
5. **The static fill path's public surface**: routing every fill through
   `insert` (R.insert) removes the marker-less `createFrame` consumer path
   (`client.ts:911–913`, a consumer-constructed frame without markers) —
   `createFrame`/`createFrameElement` are `@experimental` public API; the
   path needs an anchor or a documented removal.
6. **`FrameHost.preview` / `Frame.preview` / `STAGED_DATA` /
   `ServerComponentHandlerOptions.onStream` / `FrameHostOptions.resolve`**
   — the public surface the R.stage and R.refwait deletions touch, already
   listed by frames-rulings §"Public surface"; nothing new here.

---

## 6. Sources

- `documentation/server-components/server-components-principles.md`
  (`spec/frames-rulings` @ `757aba41c`): §2 A0 and the A1–A7/L1 annotations,
  §4's 2026-10-05 note, §6 (the ≤ 7,800 B min+gzip budget), DR-4's Stage 3
  refinement ("frame segments keep `#revealSegment`").
- `documentation/server-components/frames-rulings.md` (same branch): the
  Principle and its four corollaries; rulings 1.1–1.6, 2.1–2.4, 3.1–3.6 with
  their `Restates:`/`Frames-specific:` lines; the fix-shape tables; §"Public
  surface these fixes touch".
- `documentation/plans/sc-layer-audit.md` (`size/sc-audit` @ `0bb67ff38`):
  §1 baselines, §2 attribution (the method and Appendix A's 234 units), §3's
  75 statements, §4 structural vs incidental, §5 packaging floors, §6.1
  options and floors, §6.5 S1–S10, §7 Q1–Q10.
- `documentation/server-components/frames-consistency-contract.md` (merged,
  #3813) and `packages/web/test/consistency/` (`c01`–`c17`,
  `harness/replay.spec.tsx`): C1–C19, R1–R10, the 22 `test.fails`.
- `packages/signals/docs/SPEC-ASYNC-SEMANTICS.md` "The hold model — L2":
  rulings 1–9; A15, A17, A18, A19, A27, A28, A29, A30, A33.
- Code on `next` @ `23176235d`: `packages/web/frames/src/{frame-client,
  client, frame-transport, frame-container-plugin}.ts`,
  `packages/web/server-functions/src/{client,shared}.ts`,
  `packages/web/serialization/src/`, `packages/signals/src/{boundaries.ts,
  signals.ts, core/scheduler.ts, core/core.ts, core/async.ts, core/lanes.ts}`,
  `packages/solid/src/client/hydration.ts`, `packages/web/src/{client,
  server, index}.ts` (`insert`, `REPLACE_SCRIPT`, `dynamic`).
- `scripts/size/` on this head: `scenarios.js` (the `frames: eager client
  consumer` and `page: base` scenarios), `bundle.mjs`, `size.mjs`,
  `floor-caps.json`.

---

## 7. Reproducing

All measurement tooling lives outside the tracked tree under
`tmp-tools/` in the worktree (git-excluded; rebuildable from this section):

- `tmp-tools/fnmap.mjs <scenario> [--json f] [--dist name=path]` — the
  source-map function-size tool: bundles the scenario exactly as
  `scripts/size/bundle.mjs` does (Rolldown from `scripts/size/node_modules`,
  `minify: true`) with `sourcemap: true`, decodes the entry chunk's map
  (`@jridgewell/trace-mapping`), and charges each mapped segment's bytes to
  the innermost named function in the dist source (acorn: declarations,
  `const f = () =>`, class members as `Class#m`/`Class##p`, object methods,
  assignment targets, class fields; anonymous closures roll up to the
  nearest named ancestor; module-level code to `<module>`; the import
  statements have no origin and are reported as `<unmapped>`). Two views:
  `units` (innermost) and `rollup` (outermost module-level function). On
  this head: frames eager 43,310 (0 B unattributed beyond the 314 B of
  imports), page base 145,569; the 13 reference figures from the SC audit's
  Appendix A match to the byte on page base.
- `tmp-tools/measure.mjs <scenario> --dist frames=<edited copy>` — min/br of
  the entry chunk with a dist override (edited copies measured in place of
  `packages/web/frames/dist/client.js`; the repo dists are untouched).
- `tmp-tools/classes.mjs` + `tmp-tools/join.mjs <fn.json> [--source …]
  [--top n] [--md] [--all]` — the class map (every unit: class, group,
  justification, core primitive for R, residue re-attribution) and the join
  that produces §1.1's totals, §1.5 and Appendix A.
- `tmp-tools/floor-spec.md` + `tmp-tools/floor.py` — the group-tagged cuts
  (`live bind trace regions assets claims dead` and the R groups `gate
  stage version dedupe insert reveal drain claimant error`, plus the two
  `glue-*` additions) as exact-string replacements over
  `tmp-tools/dist/L0/client.js` (a verbatim copy of the built dist), each
  asserting its anchor matches once; `python3 tmp-tools/floor.py
  'name:group+group'` writes `tmp-tools/dist/<name>/client.js`, e.g.
  `L8:F+dead+R`, `TF:R+dead`, `T+live:bind+trace+regions+assets+claims+dead+R`,
  `Tglue:F+dead+R+glue-reveal+glue-hold`. `tmp-tools/floor-results.txt`
  holds every measurement §2–§3 quote.
- JSON: `tmp-tools/fn-frames.json`, `tmp-tools/fn-base.json`.

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
