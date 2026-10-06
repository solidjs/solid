# Frames savings pass — A0 deletions, server-announced tiers, the lazy materializer re-based (2026-10-06)

Branch `size/frames-a0-reattribution` off `next` @ `23176235d`. **A plan, not
a change**: nothing here edits an engine. It is the sequence that takes the
frames client from today's 13,770 B br eager to a transport-only default
with every capability behind a tier, under the model the maintainer accepted
from `frames-a0-reattribution.md` on 2026-10-06 — conditional on _"if we
don't anticipate timing issues"_. §1 is that condition made explicit; every
later step cites it.

**This plan supersedes the SC size audit's §6.5 step plan (S0–S10,
`documentation/plans/sc-layer-audit.md`, `size/sc-audit` @ `0bb67ff38`).**
S0 was the audit; S1 is built (`size/s1-lazy-store-materializer`, three
commits — §5 says what becomes of each); S2 (`preserveModules`) and S3 (the
server-driven preload seam, the audit's §D) survive as this plan's steps 10
and 2; S4–S6 (B.2, B.3 + E.c, E.a + E.b) are re-cut here along the §1.3a
split of E.a and the A0 classes; S7–S10 (the rulings pass) are replaced by
the A0 deletions through the six seams, which delete more (≈ 1.9 KB br of R
measured, against S7–S10's ≈ 1.8 KB estimated) by a different route — the
core already has the mechanism, so nothing is rewritten, only routed.

Inputs: `documentation/plans/frames-a0-reattribution.md` (this branch; §1
classes incl. the E.a1 / E.a2 split, §2 the measured floor, §3 tiers, §5
the six core seams S-flush / S-hold / S-record / S-ref / S-reveal /
S-adopted (+ S-key, S-swap), §5.3); `frames-rulings.md` + the principles'
A0 (`origin/spec/frames-rulings` @ `757aba41c`: rulings 1.1–3.6, 3.1
**ruled**, the order-of-work table, the public-surface list); the
consistency contract (#3813: C1–C19, the twenty-two `test.fails`, the
harness); the S1 branch (`origin/size/s1-lazy-store-materializer`:
`8629a93be` the lazy materializer via `solid-js/internal/container-trace`,
`ef6147557` the caps, `9927ddddd` the hydration-consistency fixes incl. the
`claiming` hint and the parked backlog); the SC audit's §5 (packaging
baseline: B.2 / B.3 / E.a / E.b / E.c measured) and §6.3 (the compatibility
surface a client change must keep).

---

## 0. The model this plans against (ruled in conversation, 2026-10-06)

- **Default eager = transport**: fetch / decode / morph / claim / refetch and
  switch, the segments and `<Loading>` machinery (the server's loading
  outcome on the wire; the client renders it — corollary 4), the slots'
  mount / update / unmount core, references and the flight codec, the
  document face's t = 0 claim. **Hole-op application (E.a1)** is transport
  by classification (re-attribution §1.3a) and **a runtime tier by
  delivery**: ops trail markup, the store buffers, no hold — the maintainer
  agreed it can be lazy. Two budget readings are planned (§6, decision 1):
  **7.8** (holes lazy; eager T ≈ 7.3 KB) and **8.0** (_"transport incl.
  streaming values"_; holes eager, 7.77 KB).
- **Runtime tiers, by load class:**
  - **holes** (E.a1) — detect-from-markup, **buffer-only**, no hold.
  - **live wire** (E.a2) — **preload-at-call**: declared at the export
    (`live(fn)`), known before the first request. (`GET` is a call-shape
    declaration, T.refs, nothing to tier.)
  - **binding slots, regions, assets** — _not_ knowable at compile time (SSR
    and SC compiled output are identical; `ssrElement` brand-checks at render
    time) nor reliably at call time; **the server knows at render time** →
    **server-announced**: a `modulepreload` for the tier chunk emitted while
    the document renders (t = 0) and a flag in the first chunk's header on a
    navigation, so the client fetches the tier in parallel with the stream.
    Residual fallback = a hold on the claim / attach of the marked element if
    the tier has not landed: bind attaches late, a nested frame mounts late,
    a stylesheet-gated segment reveals late (§1 decides whether assets can
    afford that).
  - **traces** — S1 as built, re-based on the same mechanism: its
    `prepareArgs` hold becomes the fallback, its registration under ruling
    3.1 stays.
- **A0 deletions** of the R units through the six seams, S-flush first; the
  contract's reds flip to green or become unrepresentable (re-attribution
  §2.4).

Baselines on this head (`scripts/size`, Rolldown, local): frames eager
**43,310 / 13,770**; page base **145,569 / 44,823** (the audit's `44,762`
is `b0bad0267`'s); page live **157,532 / 48,576** (audit: `48,436`); app
hydrating (no stores) 52,537 / 17,705; compiled hydrating 99,168 / 30,943.
Every Δ below is min / br, brotli measured from an edited dist copy where
the re-attribution measured it (`tmp-tools/floor-results.txt`) and marked
_est._ otherwise.

---

## 1. Timing-risk register — the maintainer's condition

A tier is safe when the thing that needs it cannot act before it lands,
_or_ acting without it is a bounded delay with the right thing on screen
meanwhile. For every runtime tier: the exact race, the symptom if it were
lost, the mechanism that bounds it, and the pin that proves it. "3.1
participant" means the hold registers as a pending boundary through
`initBoundaryResume` (ruling 3.1 / 3.2 — hydration-done waits for it, the
event-replay window stays open); "runtime wait" means a post-first-flush
buffer with no hydration involvement.

| tier                     | the race (what arrives before what)                                                                                                                                                                                                     | symptom if lost                                                                                                                                                                                    | bound                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | class                                                                                                                               | pin                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **holes** (E.a1)         | a `hole` / `attr` chunk — or an op on the document's `sc:live` stream — arrives before `tier-holes.js` has loaded. Always after the frame's first flush (holes are later yields; the markup that carries the `lh:` markers came first). | the frame freezes at its first yield (wrong content, silent).                                                                                                                                      | **buffer, no hold.** Stream face: `chunkToRecords` writes `hole:<k>` / `attr:<k>` into the store regardless; `#flush`'s hole pass runs only when the tier is resident, and records it cannot apply **stay pending** (store-model: any later flush retries). The tier's load triggers one `flush()` on every registered frame. Document face: the `sc:live` `ReadableStream` buffers until `pumpLiveChannel` runs (after the load); the op log replays to adopters. The announcement (§2) starts the fetch at the header / at t = 0, so in practice the chunk is resident before the first later yield.     | runtime wait                                                                                                                        | **existing:** C13 control arm (one hole alone applies), C18's pump-catch-up arm (ops before the adopter replay). **New:** `tier-holes-buffer.spec` — (a) stream: a `hole` chunk delivered before the tier resolves applies after it, nothing applied twice; (b) document: ops written to `sc:live` before the pump starts land after it; (c) a frame disposed during the wait applies nothing. The 3.1 question does not arise (post-first-flush).                                      |
| **live wire** (E.a2)     | a `live()` loop's first response (SSE framing, `LIVE_WIRE` in the call context) reaches `handle` before `tier-wire.js` has loaded.                                                                                                      | the response is read as a plain frame stream: no join/hold, no reconnect with a have-list; a reconnect lands as a full snapshot (today's post-adoption connect already does). Degraded, not wrong. | **preload-at-call.** `live(fn)`'s client decorator fires a hook the frames client installs (`configureServerFunctionsClient({ onLive })` — frames already imports `configureServerFunctionsClient`, so the dependency direction holds) that calls `prepareTier("wire")` **before** the first `fetch`; `handle`'s `LIVE_WIRE` arm awaits the same promise before reading the body, so a live connection without the chunk is impossible by construction. No buffer, no hold.                                                                                                                                | runtime wait (none in practice — the import and the request race only against each other, and the dispatch awaits the import)       | **existing:** the live suite (`server-functions-live-*`, `frames-live-*`; `live` is 22/61 branches covered — the audit's hot spot, §6.4). **New:** `tier-wire-preload.spec` — the first live response is held until the tier resolves; a response that completes before the tier never reaches the plain reader; `resume` sends the have-list on the first reconnect.                                                                                                                   |
| **traces** (S1 re-based) | an adopt-time record whose literal args carry a `{ $tr, $ta }` marker — or a `data` chunk whose node tree holds the trace plugin's node — before `container-trace.js` (the materializer + the store engine) has loaded.                 | the fill runs with an inert marker object (`TypeError` or wrong content); on the codec face the chunk decodes a marker instead of a container.                                                     | **announce + hold.** Document: the server knows it serialized a trace (the serializer stamps it) → `modulepreload` at t = 0 + the `sc:tiers` record; the occurrence is **held** (S1's `#argsUnprepared` → the general held set) with its server interior on screen, the mount being the hydration attach; it mounts with the record it was held on (S1 commit 3). Codec: `prepareData` scans the node tree and awaits the tier before the chunk decodes (S1 as built; the header flag makes the scan a confirmation). The claim reads the snapshot; the backlog lands after done (3.6 (iii), S1 commit 3). | **3.1 participant** (document face: the hold is an adopt-time occurrence deferred — registers through `initBoundaryResume`, step 9) | **existing (S1):** `frames-container-lazy-codec` (loads before decode / loads nothing), `frames-container-lazy-document` (held with the interior on screen, then mounted), `hydration/welcome-status-lazy` (claims in place, no key misses), `container-trace-hold-{id-determinism, interruption, record-retention, snapshot}`. **Re-pin:** `container-trace-hold-hydration-end` under 3.1 — _hydration waits for the load; the mount claims before done_ (rulings 3.1 "Consequences"). |
| **regions**              | a `slot:` record naming a `{$frame}` ref — or a `data-fid` region element inside adopted content — before `tier-regions.js` has loaded.                                                                                                 | the fill receives the raw `{$frame}` ref (wrong content); an occluded region cannot mount from the store.                                                                                          | **announce + hold.** The sink knows at render it passed server content as a prop (`{$frame}` minted) → announced. Adopt path: the occurrence is held in the same set as traces (its interior stays on screen; `#resolveArgs` runs after the load). Stream path: the record stays pending in the store until the load's flush (buffer).                                                                                                                                                                                                                                                                     | **3.1 participant** on the adopt path; runtime wait on the stream path                                                              | **existing:** `frames-regions-*`, the lifecycle matrix's region rows. **New:** `tier-regions-hold.spec` — adopt-time `{$frame}` occurrence held, interior intact, mounts after the load with the held record; a stream record with a region ref applies after the load; hydration-done waits (3.1).                                                                                                                                                                                     |
| **assets**               | a `reveal` for a segment whose `seg:<k>:assets` record names stylesheets (or `waitForStyles`) before `tier-assets.js` has loaded. Stream face only — the document face keeps the core's `$dfs`.                                         | **without a bound: FOUC** — the segment reveals unstyled, then the sheet lands. With the bound: the fallback stays on screen longer.                                                               | **announce + reveal-readiness term.** The sink knows at render that a fragment is style-gated → announced in the header; `#segmentReady` gains one term: "the segment's `assets` record names styles **and** the tier is not resident → not ready". The fallback — the server's `<Loading>` outcome — stays; the reveal happens at max(tier load, stylesheet load), and the stylesheet's own load dominates on every network. A segment without stylesheets never waits. Modules / preloads / inline styles are not reveal-gating today and stay so.                                                       | runtime wait (the segment swap is post-first-flush)                                                                                 | **existing:** `frames-assets-*` (`waitForStyles`, the style gate; note `ensureStylesheet` / `applyInlineStyles` have **0 client tests** — the audit's gap, to be pinned in step 7 regardless of tiering). **New:** `tier-assets-ready.spec` — a `reveal` for a style-gated segment before the tier resolves keeps the fallback; reveals once the tier and the sheet are both in; an unstyled segment in the same stream reveals immediately.                                            |
| **binding slots**        | `_s:` markers (attribute / class / style / text positions, `_s:on:*` handlers, `_s:ref`) in markup — document or stream — before `tier-bind.js` has loaded.                                                                             | positions sit at the server's values (inert attributes, classes, text); **handlers are not attached — a click in the window is lost** unless the hydration event-replay window is still open.      | **announce + hold.** The sink knows at render it emitted `_s:` (binding positions are minted by the slot props' proxy) → announced at t = 0 / in the header. Adopt path: an occurrence with `ctx.positions` is **held** (same set), which keeps `_$HY.done` false and the delegated-event replay buffer open until attach — the click is replayed. Stream path: the occurrence stays pending in the store until the load's flush. The audit's §7 Q5 (one chunk load before a post-load stream's first binding) is accepted for B.3 and applies here.                                                       | **3.1 participant** on the adopt path; runtime wait on the stream path                                                              | **existing:** `frames-binding-slot-*`, `slot-positions-*`, the #3704 / #3714 suites. **New:** `tier-bind-hold.spec` — held occurrence's positions untouched until the load; attach after; **a click dispatched during the hold replays after attach**; hydration-done waits (3.1); a stream occurrence binds after the load.                                                                                                                                                            |

**Fallback I consider not acceptable without its bound: assets.** The
reveal-readiness term is what makes the tier safe — without it the first
style-gated segment of a navigation would FOUC on every cold load. With it
the only cost is latency, and that latency is already paid for the sheet.
So assets **can be tiered**, with the term, and with the announcement made
mandatory for style-gated fragments (the sink flags the header when it
emits a `reveal` with `waitForStyles`). If the maintainer prefers no new
latency term at all, assets eager costs +684 br and puts the default build
over both budget readings (§4) — the alternative (audit S10) is routing
the mirror through `web`'s own asset registry via `client.ts`'s existing
import edge, which replaces ≈ 750 B of untested mirror with calls into
code every hydrating page already ships.

**Second-most visible: bind's dead-handler window** — bounded only because
the adopt-path hold is a 3.1 participant (the replay buffer stays open).
This is why the hold must register, not merely wait: a bare `await` would
let `_$HY.done` flip and the click fall on the floor. Step 8 depends on
step 9's S-hold for this reason.

**No tier holds on hydration-done for the stream face.** Every stream-path
wait is a store record staying pending until a flush can apply it — the
store already does this for `{$ref}` and for a record whose target is not
in the DOM yet. The holes tier adds nothing new to that model; regions,
assets and bind add one "tier resident?" term each to an existing
readiness check.

---

## 2. Foundation: the server-announced tier mechanism (build once)

Everything tiered — holes, traces, regions, assets, bind, and the wire
tier's `prepareTier("wire")` call — consumes one mechanism. It replaces
S1's two specific seams (`FrameHostOptions.prepareData(chunk)` and
`prepareArgs(record)`) with one general one.

**Wire.** Three additive items, all ignorable by an old client and absent
from an old server (the new client then falls back to the hold):

- **Stream face — a response header** `X-Frame-Tiers: bind,regions,assets`
  (names, comma-separated; omitted when empty). Set by
  `serverComponentResponse` from the sink's tier set at **first flush** —
  the header must precede the body, so the set is what the render has
  minted by the first flush; a tier first needed by a later segment is
  covered by the hold (the fallback) and by the next response's header.
  Additive to the §6.3 header list; RFC 11 addendum.
- **Document face — `<link rel="modulepreload" href="…">`** per tier in the
  streamed head (the `lazy()` manifest path the audit's §D named; the URL
  comes from the app bundler's manifest the way route chunks' do), **and**
  a hydration record `_$HY.r["sc:tiers"] = ["bind", …]` written with the
  first SC's records so the client starts the `import()` at install even
  when the preload link is stripped or the manifest is absent. Additive to
  the §6.3 hydration-data list.
- **Nothing else changes**: `FrameChunk` kinds, store keys, DOM markers,
  `_$SC`, the registered symbols — unchanged. The `ops` member (C13's
  delimiter) is a separate wire item and not this plan's.

Is it a wire change? **Yes, additive** — the compatibility surface in
audit §6.3 gains one header and one hydration key; old/new in either
direction degrades to the hold, never to wrong content. Decision 3 (§6)
asks the maintainer to accept it.

**Server half.** The sink already _is_ the place that learns a tier is
needed: `frame-sink.ts` mints `_s:` positions when a slot prop is bound at
an attribute / text position (`slotProps` proxy, `ssrClaim`), mints
`{$frame}` when server content crosses the slot border, writes `assets`
records / `waitForStyles` on a style-gated fragment, stamps a container
trace at serialization, and arms `liveHoles` on every render (holes are
_always_ possible and so announced only when the render actually minted an
`lh:` / `lha:` marker — `createLiveHoles`' first `openBinding`). One
`sink.needs(tier)` call at each of those five sites adds the name to a
`Set` on the response context; `serverComponentResponse` reads it into the
header at first flush; the document sink writes the `sc:tiers` record and
the head's `modulepreload` links at the first SC's flush (the head is
still open then — the same window `registerHeadTags` uses). ≈ 300–450 B
min on the server (`est.`; five one-line calls, one header write, one
record write, the link emission through the existing head registry).

**Client half — `prepareTier(name)`.** One seam in `frames/src/client.ts`:

```ts
// tiers: name -> module promise; the chunk list is the bundler's
const tiers = new Map<string, Promise<unknown>>();
const prepareTier = name =>
  tiers.get(name) ?? (tiers.set(name, TIER_LOADERS[name]().then(installTier)), tiers.get(name));
```

- `installServerComponents` reads `_$HY.r["sc:tiers"]` and calls
  `prepareTier` for each (the `modulepreload` made the fetch warm, so this
  is a cache hit).
- `createServerComponentHandler.handle` reads `X-Frame-Tiers` off the
  response and calls `prepareTier` for each **before** `applyFrameResponse`
  starts reading the body — the tier downloads in parallel with the
  stream.
- `live()`'s decorator fires the `onLive` hook `installServerComponents`
  registers through `configureServerFunctionsClient`; the hook calls
  `prepareTier("wire")` before the first fetch (preload-at-call); `handle`'s
  `LIVE_WIRE` arm awaits the same promise before reading the body.
- The **fallback** is one predicate per tier at its existing readiness
  check: `#syncSlots` holds an adopt-time occurrence whose args carry a
  marker / `{$frame}` / whose ctx has `positions` while the tier is not
  resident (the held set S1 built, generalized — `#heldRecords` keyed by
  occurrence, carrying the record it was held on); `#segmentReady` treats
  "styles named and assets tier absent" as not ready; the hole pass runs
  only when `tier-holes` is resident. Each tier's module installs itself
  into the frames client's dispatch table (`installTier`: the hole
  appliers, the region resolver, the asset loader, the bind positions
  walker, the wire arm) and triggers a `flush()` on every registered frame
  and a `sync()` on every adopted one.
- `prepareTier` **replaces** `FrameHostOptions.prepareData` /
  `prepareArgs`: the host's `prepareData(chunk)` becomes
  `needsContainerTraceMaterializer(chunk) && prepareTier("trace")` inline;
  `prepareArgs(record)` becomes the held-set predicate above. The
  `loadContainers` import stays what S1 made it (`solid-js/internal/
container-trace`) and is `TIER_LOADERS.trace`.

**Bytes.** Client ≈ +250–350 min / **+80–110 br** on frames eager and both
pages (`est.`: the map + loader table ≈ 120, the header read ≈ 40, the
record read ≈ 30, the generalized held set ≈ 100 over S1's `#argsUnprepared`
— net of S1's two faces, which cost +543 / +134 and go). Server ≈ +300–450
min. The compiled-hydrating and signals scenarios: 0 (nothing in solid).

**Pins.** New `tier-announce.spec` (server): the document emits one
`modulepreload` + the `sc:tiers` record per minted tier and none when
nothing is minted; the stream header lists the tiers minted by first
flush. New `tier-prepare.spec` (client): `prepareTier` is idempotent per
name; the header starts the import before the body is read; a tier
announced in the document is resident before the first adopt-time sync
that needs it (the warm fetch); an **un-announced** response falls back to
the hold / buffer and converges to the same DOM. Harness: the artifacts
(`harness/__artifacts__`, 146) re-record once for the `sc:tiers` record
and the links; the consistency laws un-ignored for the tiers.

**Public surface (its own item):** `FrameHostOptions.prepareData` and
`prepareArgs` (S1's, `@experimental`) are **replaced** by the internal
`prepareTier`; `installServerComponents` gains no option (the record is
read, not configured); `ServerComponentHandlerOptions` gains nothing. The
header name and the hydration key are wire (above).

---

## 3. Steps

Each step is one PR off `next`. Gate = PR #3813's contract (named pins flip
to `test`, every other pin and the harness's laws stay green, the whole
frames / hydration suite green) **plus** `scripts/size` (every scenario ≤
its cap; the step's expected Δ stated in the PR; caps lowered at landing —
the ratchet; raises are the maintainer's, by Size-Exception) **plus** the
timing pins of §1 for any step that tiers. Δ columns: frames eager / page
base / page live / compiled hydrating (br unless marked). Chunk sizes are
what the step creates as lazy chunks (reported by the harness, not
counted). "Surface" items are flagged as their own line.

| #      | step                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Δ br (frames eager / page base / page live / compiled hydrating)                                                                                                                                                         | chunks created                                                                                                                                                     | gates (pins flip; size)                                                                                                                                                                                                                                                                                                                                                                                                                                   | depends on                                                                                                                                              | surface                                                                                                                                                                                                                                                                                                                                                 |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **0**  | **S1 merges as built** (§5): the lazy materializer, the caps, the consistency fixes. Its frames-eager +134 br over the 13.78 KB cap is accepted as a Size-Exception **retired by step 2** (whose shared seam absorbs S1's two faces).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | **+134 / −6,390 / −6,352 / 0** (S1 measured)                                                                                                                                                                             | `container-trace.js` 24.3 KB / **7.86 KB br**                                                                                                                      | S1's pins; caps page base 38.45, live 42.12 (S1's `ef6147557`); frames eager exception                                                                                                                                                                                                                                                                                                                                                                    | #3813 landed                                                                                                                                            | `FrameHostOptions.prepareData(chunk)`, `prepareArgs`, `revive(value, claiming?)`, `setContainerTraceMaterializer(…, claiming?)`, the `solid-js/internal/container-trace` entry, `withStoreHydration` / `applyPatches` / `forwardIteratorReturn` `@internal` on the main entry — S1's, already flagged                                                   |
| **1**  | **S-flush + the R deletions it unlocks.** `content = createMemo(() => host.landing(binding()))` — one reactive node per bound address resolved at the version's first root / error write (the host's `landing(address)`: a promise for a cold store, the value for a warm one); the enclosing `<Loading>` pends on it, a switch is a new flight (`_inFlight` supersession, 1.6 (i) by construction), a refetch's landing is staged by the Transaction that read it (G7 closes). Deletes: **R.gate** (`arm`/`release`/`settle`/`setGate`/`mountGate`, the adopted twin), **R.stage** (`stage` / `stageTables` / `stagedContent` / `CONTENT_TOKEN` / `STAGED_DATA` / `FrameImpl#preview` / `#regionsChange` / `host.preview`; the chunk buffer-until-`complete` stays, one write), **R.version** (2a: one applied record keyed by identity; `#appliedRoot`), **R.dedupe** (per-prop memos in `slotArgsProxy`; `argsEquivalent` / `#refArgsUnchanged` / `#slotResolvedRefs` go), **R.error**'s latch. Files: `frames/src/client.ts` (`boundaryComponent`, `adoptBoundary`, `followAddress`), `frame-transport.ts` (`stage*`, `handle`), `frame-client.ts` (`#apply`, `#flush`, `preview`, `#syncSlots`' dedupe arms). | **≈ −1,150 / ≈ −1,150 / ≈ −1,150 / 0** (`est.` from the measured R total −1,863 with every feature kept, scaled to the 4,170 of 6,655 R-min these groups are; S-flush's own glue ≈ +110–190 min / +40 br is inside this) | none                                                                                                                                                               | **flip:** C5 (a, b, e) with the per-response data cell (1.2), C6 (b2), C7 (c), C17 (a); **C17 (c) re-pins** to 1.6 (i) `waiting → B`; C6 (b1) inverts (asserts the opposite of A0). Size: frames eager ≤ 12.7 KB (from 13.78 / S1's 13.9), page base ≤ 37.3, live ≤ 41.1.                                                                                                                                                                                 | step 0 (so S1's `#argsUnprepared` hold and `revive(…, claiming)` are in the tree the gate re-shapes)                                                    | **removed / changed:** `ServerComponentHandlerOptions.onStream`, `FrameHostOptions.resolve` / `FrameHost.resolve`, `FrameHost.preview` / `Frame.preview`, `STAGED_DATA` — the rulings' step-4 list. **New:** `FrameHost.landing(address)` (internal).                                                                                                   |
| **2**  | **The tier mechanism** (§2): `sink.needs(tier)` at the five mint sites; `X-Frame-Tiers` at first flush; `sc:tiers` record + `modulepreload` links on the document face; `prepareTier(name)` + the generalized held set + `installTier`; S1's `prepareData` / `prepareArgs` folded in. No tier is cut yet — this step is the seam alone, measured.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | **≈ +100 / ≈ +100 / ≈ +100 / 0** gross, **≈ −35 / −35 / −35 / 0** net of S1's two faces (`est.`); server ≈ +300–450 min                                                                                                  | none new (trace's chunk already exists)                                                                                                                            | `tier-announce.spec`, `tier-prepare.spec` (new); S1's pins unchanged; artifacts re-recorded once. Size: frames eager back under 13.78 (S1's exception retired).                                                                                                                                                                                                                                                                                           | step 0; step 1 is not required but the gate's `landing` node is what the installed tier's `flush()` wakes                                               | **wire (additive):** `X-Frame-Tiers`, `_$HY.r["sc:tiers"]`, the links. **Replaced:** `prepareData`, `prepareArgs` → internal `prepareTier`. Decision 3.                                                                                                                                                                                                 |
| **3**  | **Holes tier** (E.a1; cheapest, buffer-only). `tier-holes.js` = `#applyHole`, `#applyAttrs` (less its owned-position arms, which are bind's), `findLiveTarget`, the hole pass, `pumpLiveChannel` + the op log + `applyLiveOp`. The eager client keeps `chunkToRecords`' `hole` / `attr` cases (records must land in the store before the tier is resident) and a one-line dispatch in `#flush`. Under the **8.0 reading** this step is skipped and holes stay eager (§6 decision 1).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | **−546 / −508 / −508 / 0** (measured: `T+holes` → `L8`; page `T+holes` → `L8`; live page the same cut)                                                                                                                   | `tier-holes.js` ≈ 1,900 min / **≈ 620 br** (`est.`: the 2,116-min cut as its own module + the install glue)                                                        | `tier-holes-buffer.spec` (new, §1); C13 control + C18 catch-up arms unchanged; `frames-live-holes-*`, `document-live-*` green through the tier. Size: frames eager ≤ 12.2.                                                                                                                                                                                                                                                                                | step 2                                                                                                                                                  | none (the record shapes and `sc:live` are unchanged; the hole appliers were never exported)                                                                                                                                                                                                                                                             |
| **4**  | **Live wire tier** (E.a2; preload-at-call). `tier-wire.js` = `connections` / `hold` / the join-or-hold arm of `handle`, `resume` + `encodeHaveList` / `FRAME_HAVE_*`, the have-list ledger (`#have` / `have()` / `#recordHave` and the record fields that feed it), `applyFrames`' connection wiring + `connection.cancel`, `isEventStream` + the SSE reader selection, `deserializeStream`'s live arm. The eager client keeps a one-line `LIVE_WIRE` dispatch in `handle` and `bump`'s cancel hook (a no-op without the tier). `live()`'s decorator fires the `onLive` hook (set by frames through `configureServerFunctionsClient`) that calls `prepareTier("wire")` before its first fetch; the arm awaits it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | **−433 / −355 / −355 / 0** (measured: `T+wire` → `L8`; the live page keeps the chunk lazy — its eager measurement drops the same bytes)                                                                                  | `tier-wire.js` ≈ 1,300 min / **≈ 470 br** (`est.`)                                                                                                                 | `tier-wire-preload.spec` (new); the live suite green; the audit's `live` branch gap (22/61) closed to ≥ 45/61 in the same PR (the tier's own tests). Size: frames eager ≤ 11.8; live page unchanged ±50 (the chunk is reported, not counted).                                                                                                                                                                                                             | step 2; independent of step 3                                                                                                                           | `ServerFunctionsClientConfig.onLive` (new, internal hook on `configureServerFunctionsClient`); `FRAME_HAVE_HEADER` / `FRAME_HAVE_BUDGET` are exported constants today and move to the tier's module — **re-export from the eager entry** to keep the surface, or flag the move                                                                          |
| **5**  | **Traces = S1 re-based.** The materializer entry and `loadContainers` stay; `prepareData` / `prepareArgs` are step 2's `prepareTier("trace")` + the held set; the codec-face node scan becomes the confirmation behind the header flag (kept — a `data` chunk may arrive on an un-announced response); the eager half of F.trace (`reviveContainerTraces` / `materialize` / `isContainerTraceMarker` / `isMaterializedContainer` / `setContainerTraceMaterializer` / `getFrameHost.revive`) moves into `container-trace.js`'s install, leaving a ≈ 150-min trigger. Re-pin `container-trace-hold-hydration-end` under 3.1 **together with step 9** (the hold must register before the re-pin can hold).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | **≈ −250 / ≈ −250 / ≈ −250 / 0** (`est.`: F.trace's eager half 843 attributed, −289 measured as `T+trace` → `L8`, less the trigger)                                                                                      | `container-trace.js` grows by the eager half (≈ +700 min / +200 br → ≈ 8.1 KB br)                                                                                  | S1's five hold pins + the three lazy pins green through the general seam; the hydration-end re-pin lands with step 9 (until then it stays as S1 wrote it). Size: frames eager ≤ 11.5; pages −0.25.                                                                                                                                                                                                                                                        | steps 0, 2                                                                                                                                              | `reviveContainerTraces` / `setContainerTraceMaterializer` (frames' `@experimental` exports) move behind the tier — **flag**: either re-export lazily-resolving wrappers or accept the move                                                                                                                                                              |
| **6**  | **Regions tier.** `tier-regions.js` = `#bindRegions` / `#regionsFor` / `#discoverRegions` / `collectRegionElements` / `disposeRegions` / `makeFrameElement` / `isFrameRef`, the `{$frame}` arm of `#resolveArgs`, the `resolveSlot` / `resolveSlotRecord` / `removeSlotRecord` thread-up, `tableFor`'s prefix walk, `drainRecords`' `sc:region:` arm. The eager client keeps the `{$frame}` detection in `#resolveArgs` (one `isFrameRef` test → hold). The rename machinery (`renameRegion` / `#reconcileRegions`, D) deletes outright — it is not moved.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | **−489 / ≈ −480 / ≈ −480 / 0** (measured on frames: `T+regions` → `L8`; pages `est.` at the same cut)                                                                                                                    | `tier-regions.js` ≈ 1,900 min / **≈ 540 br** (`est.`)                                                                                                              | `tier-regions-hold.spec` (new); `frames-regions-*`, lifecycle matrix region rows green; principles §4 row 19 (the rename compensations) deleted with D. Size: frames eager ≤ 11.0.                                                                                                                                                                                                                                                                        | step 2; step 9's S-hold for the adopt-path hold to register (ship the hold as a plain wait first if 9 is later, **flagged** as a 3.1 gap until 9 lands) | none (`createFrameElement` stays eager — it is `@experimental` public API, re-attribution §5.3 item 5)                                                                                                                                                                                                                                                  |
| **7**  | **Assets tier.** `tier-assets.js` = `ensureStylesheet` / `ensurePreload` / `ensureModulePreload` / `applyInlineStyles` / `qualifierValue` / `findHeadElement` / `PRELOAD_QUALIFIERS` / `#processedAssets` / `#styleFlush` / the assets pass; the eager client keeps `chunkToRecords`' `assets` case, `host.write`'s `seg::assets` accumulate, and the `#segmentReady` term. **Pin the two untested functions first** (`ensureStylesheet`, `applyInlineStyles` — the audit's 0-coverage gap) in the same PR. Alternative under decision 2: S10's route-through-`web` instead of a tier.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | **−684 / ≈ −665 / ≈ −665 / 0** (measured on frames: `T+assets` → `L8`; the `noassets` full-client cut −665)                                                                                                              | `tier-assets.js` ≈ 2,400 min / **≈ 760 br** (`est.`)                                                                                                               | `tier-assets-ready.spec` (new, the FOUC guard); `frames-assets-*` green; the two new coverage pins. Size: frames eager ≤ 10.3.                                                                                                                                                                                                                                                                                                                            | step 2                                                                                                                                                  | none                                                                                                                                                                                                                                                                                                                                                    |
| **8**  | **Binding-slot tier** (E.c; largest, last of the tiers — it needs the 3.1 hold for the event-replay window). `tier-bind.js` = `bindDataOccurrence` (+ `valuesFor` / `write` / `release` / `writeText`; its second diff layer above `assign` — ≈ 300 B, D — deletes rather than moves), `slotPositions` / `slotEntry` / `textPosition` / `consumersOf` / `consumersEqual` / `ownedPositions` / `morphOwnedClass` / `morphOwnedStyle` / `applyOwned`, the `_s:` branch of `collectSlots`, the consumer-rebind arm of `#syncSlots`, the owned-position arms of `morphAttributes` / `reconcileChildren` / `#applyAttrs`, the `ctx.positions` branch of `slotsFor`; **`assign` leaves the eager frames client with it** (the page then keeps `assign` only through `dynamic`'s string tag — B.3, step 10).                                                                                                                                                                                                                                                                                                                                                                                                              | **−1,546 / −2,504 / −2,542 / 0** (frames measured `T+bind` → `L8`; pages: the audit's E.c measurement — `assign` leaves on the page too)                                                                                 | `tier-bind.js` ≈ 5,000 min / **≈ 1,650 br** on frames (`est.`); on a page it carries `assign` as well (≈ +3,000 min / +900 br) unless B.3 has already made it lazy | `tier-bind-hold.spec` (new, incl. the click-replay arm); `frames-binding-slot-*`, `slot-positions-*`, #3704 / #3714 suites green. Size: frames eager ≤ 8.8 (both readings), page base ≤ 32.6, live ≤ 36.3.                                                                                                                                                                                                                                                | steps 2, **9** (the hold registers)                                                                                                                     | none public (the `_s:` marker grammar is unchanged; `bindDataOccurrence` was never exported)                                                                                                                                                                                                                                                            |
| **9**  | **Remaining C-fixes under the rulings** (the seams S-flush did not cover). **3a / S-hold:** the held set registers through `initBoundaryResume` — `hydrateWindow(id, fn, roots?)` factored out of `resumeBoundaryHydration` and `initBoundaryResume` reachable from the adopter (`sharedConfig.resumeBoundary`); replaces `Tglue`'s bounded `prop#n` poll (+82 br) with the registration (≈ +100 min frames / +40–65 min solid). **2b / S-reveal:** the `fr.subscribe` → `frame.sync(parent)` one-liner (+23 br). **S-record** (server half: the sink writes `sc:slot:<fid>:<occ>` as a declared pending ref, +≈ 30 B/record of output) **or** the solid write hook (+40 B) — removes the poll's last reason. **S-ref:** the codec table answers an undelivered `{$ref}` with a pending promise rejected at `complete` / `:error`. **S-adopted:** `_adoptedRoots` so `fragmentPolicy` swaps inside an adopted frame post-done (G4). **S-key:** `whenRevealed` exposed + the fragment key on the SC reference. Deletes **R.drain / R.claim / R.claimant / R.refwait / R.reveal**'s readiness model (the segment swap's DOM half stays — T.morph).                                                                   | **≈ −350 / ≈ −350 / ≈ −350 / ≈ +40** (`est.`: the remaining R ≈ −1,701 + 1,150 already taken ≈ −550 br of cuts, less the seams' glue ≈ +200 br on frames; solid +≈ 150–200 min ≈ +40–50 br on every hydrating page)      | decode chunk +≈ 60 B (S-ref)                                                                                                                                       | **flip:** C3 (a) + the harness's C3 replay, S1's C3 (b); C2 (a2, b) + the C2 replay; C4 (d); C6 (a1); C18 ×3 (unrepresentable → the pins assert the pending read); **re-pin:** S1's `hydration-end` (with step 5). C12 (c) and C13 (a, b) stay the server half's. Size: frames eager ≤ 8.5; **compiled hydrating and app hydrating need a cap raise of ≈ +50 br — the maintainer's** (compiled hydrating is at its cap on this head: 30,943 vs 30.93 KB). | steps 1, 5 (the re-pin), 6, 8 (their holds)                                                                                                             | **solid:** `sharedConfig.resumeBoundary` or an `internal` export of the registration (rulings' list: no new counter, no new done path); `whenRevealed` on `_$HY.fr`; `_$HY.fr.adopt/unadopt`. **frames:** `FrameOptions.hold` (internal). **server:** the declared slot record (output shape, +30 B/record), the fragment key on the reference (+30 B). |
| **10** | **Packaging remnants from the SC audit, if still relevant after tiering.** **S2 / C** `preserveModules` for `solid-js` / `@solidjs/web` (0 on single-entry scenarios; the enabler): lets the store **hydration adapters** (≈ 2.6 KB min, the ≈ 1.3 KB br S1 fell short of B.2's floor by) follow the engine into `container-trace.js`, and lets **B.3** (`dynamic`'s string-tag branch lazy, `staticElement` behind the seam) take `assign` off the page. **B.3:** page −2,372 / −2,391 br (audit measured), frames 0. **E.b** (sf natural-encoding bodies, codec-args message, `Retry-After` / trailer parsing lazy): −65 frames / −476 base / −519 live (audit floor). **E.c's other half** is step 8. **Lazy codec:** already a chunk (22,986 / 6,074) — nothing to do. **Claims + event** (F.claims, F.event, 331 br): not a frames tier — they ride the router's chunk (the router installs `CLAIM_SEAM`); the frames client keeps the ≈ 60-B seam.                                                                                                                                                                                                                                                           | **≈ −400 / ≈ −4,100 / ≈ −4,200 / 0** (`est.`: claims+event −331 frames; B.3 −2,372, the adapters ≈ −1,300, E.b −476 on page base)                                                                                        | `dynamic-static.js` ≈ 8,000 min / ≈ 2.4 KB br; the sf natural-body chunk ≈ 1,600 min / ≈ 480 br; the router's claims chunk ≈ 900 min / ≈ 330 br                    | the audit's S2 band (single-entry scenarios ≤ ±50 B); B.3's hydration specs; `CLAIM_SEAM` tests with the router. Size: frames eager ≤ 8.1, page base ≤ 28.2, live ≤ 31.8.                                                                                                                                                                                                                                                                                 | steps 5, 8 (so what leaves with `assign` is known)                                                                                                      | B.3: `dynamic`'s string-tag branch becomes async-loading on first use (behaviour change accepted in audit §7 Q5 / B.3); the `CLAIM_SEAM` install moves to the router                                                                                                                                                                                    |
| **11** | **Budget restatement — principles §6 as per-tier lines** (§4's table is the draft). One line per eager default (both readings written, one picked), one per tier chunk, the page lines, the ratchet rule unchanged ("a ceiling increase requires a new mechanism row citing its axiom"), `floor-caps.json` gains the tier chunks as reported-not-counted lines with their own caps.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | 0                                                                                                                                                                                                                        | —                                                                                                                                                                  | `check-floor-caps` clean on `next`                                                                                                                                                                                                                                                                                                                                                                                                                        | all                                                                                                                                                     | —                                                                                                                                                                                                                                                                                                                                                       |

**Order rationale.** Foundations first: step 1 (S-flush) is the biggest
deletion and changes the shape every tier's `flush()` wakes; step 2 is the
one mechanism every tier consumes, measured alone so its cost is known
before anything rides it. Tiers cheapest / safest first: holes (buffer-only,
no hold, 546 br) → wire (preload-at-call, no race by construction) →
traces (S1's pins already exist) → regions → assets (the one with a visible
fallback — its FOUC guard is pinned before the cut) → bind (largest, and
the only tier whose fallback needs the 3.1 hold for correctness, so it
waits for step 9's registration — or ships its hold as a plain wait first,
flagged). Step 9 is placed after the tiers because the registration it
builds is what the tiers' adopt-path holds need to become 3.1
participants, and because its solid-side bytes are the one cap raise in
the plan — better made once, with every hold known. Step 10 last: its
items are page-only and depend on knowing what left with `assign`.

**Cumulative size gates (frames eager br, 7.8 reading):** 13.78 (S1
exception 13.9) → 12.7 (1) → 12.7 (2) → 12.2 (3) → 11.8 (4) → 11.5 (5) →
11.0 (6) → 10.3 (7) → 8.8 (8) → 8.5 (9) → 8.1 (10). The end state (§4) is ≈
7.2–7.3 KB; the 8.1 gate after step 10 leaves ≈ 0.8 KB for the parts of R
and D the floor removed that no step above names explicitly (the re-
attribution's §1.4 D list ≈ 318 br; the sf slice's live arm; the second
dispose map; `documentAddress` and the `_$SC` mirror) — they go in steps 1
and 9 as their call sites vanish, and the gates tighten to the measured
value at each landing (the ratchet).

---

## 4. End state

Eager default (frames eager scenario, br; every tier out, R and D deleted,
the seams' glue in):

| reading                                                      | eager default                                                                         | basis                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **7.8 — transport, holes lazy** (recommended, §6 decision 1) | **≈ 7,250 B** (band 7,150–7,350)                                                      | `Tglue` 7,332 measured (`L8` + the one-liner + the poll) − the poll (−82) + S-hold's frames glue (+35) + `prepareTier` (+95) + the hole-case dispatch kept eager (+20) − the R residues the floor could not cut without seams (R.claim ≈ −150, R.refwait ≈ −45, the sf live arm ≈ −50) |
| **8.0 — transport incl. streaming values, holes eager**      | **≈ 7,800 B** (band 7,700–7,900)                                                      | the same + `T.holes` 546                                                                                                                                                                                                                                                               |
| as shipped                                                   | 13,770                                                                                | `L0`                                                                                                                                                                                                                                                                                   |
| the SC audit's floors                                        | P packaging only ≈ 12,300; C carve ≈ 11,500; P + C′ ≈ 10,500; S10 end ≈ 10,500–10,800 | audit §5, §6.1, §6.5                                                                                                                                                                                                                                                                   |
| the re-attribution's measured floors                         | `L8` 7,227; `T+holes` 7,773; `Tglue` 7,332; `Tglue+holes` 7,871; `TF` 11,589          | `floor-results.txt`                                                                                                                                                                                                                                                                    |

Tier chunks (lazy, reported not counted; br):

| tier                      | chunk br (est. unless marked)                                                                            | load class                     | hold                              |
| ------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------ | --------------------------------- |
| `tier-holes.js`           | ≈ 620                                                                                                    | detect-from-markup (announced) | buffer only                       |
| `tier-wire.js`            | ≈ 470                                                                                                    | preload-at-call                | none                              |
| `container-trace.js`      | **7,860 measured** (S1) → ≈ 8,100 with the eager half moved in; ≈ 8,800 if the adapters follow (step 10) | announced                      | 3.1 participant (adopt path)      |
| `tier-regions.js`         | ≈ 540                                                                                                    | announced                      | 3.1 participant (adopt path)      |
| `tier-assets.js`          | ≈ 760                                                                                                    | announced                      | reveal-readiness term             |
| `tier-bind.js`            | ≈ 1,650 (frames); ≈ 2,550 on a page carrying `assign` until B.3                                          | announced                      | 3.1 participant (adopt path)      |
| `dynamic-static.js` (B.3) | ≈ 2,400                                                                                                  | first string-tag `dynamic`     | async first render (accepted, Q5) |
| sf natural body (E.b)     | ≈ 480                                                                                                    | first natural-encoding call    | none                              |
| `decode.js`               | 6,074 measured                                                                                           | first `data` chunk             | the chunk awaits it (today)       |
| router claims             | ≈ 330                                                                                                    | the router installs it         | re-sweep on install               |

Pages (br; the whole page, lazy chunks not counted):

| scenario                  | today (head / audit)      | after steps 0–9 (tiers + A0; `est.` from the measured `L8` page cuts + the seams)                                                                                | after step 10 (+ B.3, adapters, E.b) | vs today             | the SC audit's floors                                              |
| ------------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | -------------------- | ------------------------------------------------------------------ |
| page base                 | 44,823 / 44,762           | **≈ 32.3 KB** (`L8` page 30,901 measured + the adapters S1 leaves eager ≈ +1,300 + seams ≈ +150) — 8.0 reading ≈ 32.8                                            | **≈ 28.1 KB**                        | **−16.7 KB (−37 %)** | packaging only ≈ 31.4; S10 end ≈ 29.5–30                           |
| page live                 | 48,576 / 48,436           | **≈ 36.1 KB** (`L8` page live 34,620 measured + adapters + seams; the holes and wire chunks load lazily on this page and are reported, not counted) — 8.0 ≈ 36.6 | **≈ 31.8 KB**                        | **−16.8 KB (−35 %)** | packaging only ≈ 35.5; S10 end ≈ 33.5                              |
| app hydrating (no stores) | 17,705                    | **≈ 17,750** (+≈ 45: S-hold's `hydrateWindow` + the registration reach, S-adopted, `whenRevealed`)                                                               | unchanged                            | +45                  | — (the rulings estimated +8 for 3a alone; the other two seams add) |
| compiled hydrating        | 30,943 (at its 30.93 cap) | **≈ 30,990** (the same +≈ 45)                                                                                                                                    | unchanged                            | +45                  | **cap raise needed — the maintainer's**                            |
| frames eager              | 13,770                    | ≈ 7,600 (7.8 reading; the step-9 gate is 8.45 before the residual R / D cuts land) / ≈ 8,150 (8.0)                                                               | **≈ 7,250 / ≈ 7,800**                | **−6.5 KB (−47 %)**  | ≈ 10,500                                                           |

---

## 5. What S1 becomes

S1 (`size/s1-lazy-store-materializer`, three commits) is the prototype of
this plan's tier model: it built the lazy chunk, the hold, and the
consistency fixes for the one tier whose chunk is big enough to have
forced the question. Under the general mechanism:

| commit                                                                            | survives as-is                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | re-shapes under the general mechanism (step 2 / 5)                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | pins                                                                                                                                                                                                                                                                                                                                                                        |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1 — `8629a93be`** the lazy materializer via `solid-js/internal/container-trace` | the **entry** (its own dist entry, the `@internal` seams it reads back from the main module — `withStoreHydration`, `applyPatches`, `forwardIteratorReturn`; the server's inert stubs); `loadContainers` as the dynamic import kept external; the frames container plugin materializing at decode                                                                                                                                                                                                               | `FrameHostOptions.prepareData(chunk)` → `needsContainerTraceMaterializer(chunk) && prepareTier("trace")` (the node scan stays as the un-announced fallback; the header flag makes it a confirmation); `prepareArgs(record)` → the general **held set** predicate (a marker literal is one of the three hold reasons: trace / `{$frame}` / `positions`); `#argsUnprepared` → the held set; the eager half of F.trace (`reviveContainerTraces`, `materialize`, the marker tests) moves into the chunk's `installTier` | `frames-container-lazy-codec`, `frames-container-lazy-document`, `hydration/welcome-status-lazy` — unchanged in assertion; their load trigger becomes `prepareTier`                                                                                                                                                                                                         |
| **2 — `ef6147557`** caps lowered to S1's measured + 10 B                          | the **ratchet itself** (lowering at landing)                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | the values re-set at each later landing; the frames-eager +134 exception S1 could not take is **retired by step 2** (the shared seam costs less than S1's two faces: ≈ −35 net)                                                                                                                                                                                                                                                                                                                                     | `check-floor-caps` clean on `next`                                                                                                                                                                                                                                                                                                                                          |
| **3 — `9927ddddd`** a held container-trace fill hydrates like a resident one      | **all three fixes**: the detached root for the projection (solid; id determinism); the parked backlog beyond the snapshot until `onHydrationEnd` with the `claiming` hint (`revive(value, claiming?)` → `reviveContainerTraces(value, claiming?)` → `materializer(marker, claiming?)`) — this is ruling 3.6 (iii), the rulings' step "3e"; the held-record mount (an occurrence held on an unresolved ref or unprepared arg mounts with the record it was held on and applies a replacement as the args change) | the held-record mount **generalizes**: it is the mechanism every announced tier's adopt-path hold uses (regions, bind), not trace-specific — `#heldRecords` keyed by occurrence becomes the held set of step 2; the park's release order (claim → hold release → done → backlog) is **pinned with 3a** (rulings 3.2 "Ordering to pin with it")                                                                                                                                                                      | `container-trace-hold-{id-determinism, interruption, record-retention, snapshot}` — survive as-is; **`container-trace-hold-hydration-end` re-pins under 3.1** at step 9 (_hydration waits for the load; the mount claims before done_ — same claim assertions, opposite order); the `.fails` id-drift pin (a keyed sibling after a frame) is ruling 3.4's and flips with 3c |

**When it merges: first — step 0, before anything else.** S1 is the
largest single saving in the plan (−6.4 KB br on both pages, measured),
is self-contained, carries its pins, and touches nothing step 1 changes
except `#syncSlots`' hold arms, which step 2 re-shapes anyway. Waiting for
the mechanism would hold the biggest win behind the riskiest work. The one
cost is a Size-Exception for the frames-eager +134 br over the 13.78 KB
cap, retired by step 2. The alternative — rebase S1 onto step 2 before
merging — saves the exception and costs the delay; I recommend against it.

What S1 **does not** become: the general mechanism's model. S1 detects
(scan the chunk / scan the args) where the plan announces; detection
stays as the fallback, so S1's behaviour on an un-announced response is
exactly the plan's fallback behaviour, already pinned.

---

## 6. Open decisions for the maintainer

Each a yes/no with a recommendation.

1. **Budget line: 7.8 (holes lazy, eager T ≈ 7.25 KB) or 8.0 (holes eager,
   ≈ 7.8 KB)?** — **Recommend 7.8, holes as a tier line.** The holes tier is
   the safest in the register (buffer-only, no hold, no hydration
   involvement, the announcement makes the race theoretical), it saves 546
   br for every consumer page that never streams, and a restated budget met
   by ≈ 0–100 B is not a ratchet — 7.8 with holes lazy leaves ≈ 550 B of
   headroom for the seams' glue to come in heavier than estimated. The
   classification (transport) does not depend on the choice; §6's table
   writes the holes line either way, eager or tier.
2. **Assets: eager or tiered?** — **Recommend tiered, with the
   reveal-readiness term and the announcement mandatory for style-gated
   fragments.** Eager costs +684 br and puts the default over both
   readings; tiered costs latency bounded by the stylesheet's own load,
   with the server's fallback on screen meanwhile (no FOUC, no blank). If
   the maintainer wants no new latency term, the alternative is audit S10
   (route the mirror through `web`'s asset registry) — fewer bytes than
   eager, no tier, and it retires ≈ 750 B of untested mirror; it is the
   second-best answer, not a bad one.
3. **Is the document `modulepreload` (+ the `sc:tiers` record + the
   `X-Frame-Tiers` header) acceptable wire?** — **Recommend yes.** All three
   are additive; an old client ignores them, a new client without them
   falls back to the hold / buffer and converges to the same DOM (pinned,
   step 2). The alternative — detection only, S1's model for every tier —
   makes every tier's first use a cold chunk load on the critical path
   (traces today: the materializer loads at the first record), which is the
   timing exposure the maintainer's condition is about. Announcement is
   what turns the register's races from "likely" into "theoretical".
4. **The plain-response streaming bound** — _"presumably not infinitely"_:
   should the server end a plain (non-`live`) response after a bound, with
   detectable truncation, `live` being the declared way past it? —
   **Recommend yes, L1 server half**: `serverComponentResponse` ends a
   plain response when either a yield count or a wall-clock bound is
   reached (defaults to decide — e.g. 64 later yields or 30 s after first
   flush, the latter aligned with the request's `signal` / platform
   timeout), by emitting `complete` with an additive field,
   `{ type: "complete", bound: "yields" | "time" }`, so the client stores
   `:complete` **and** `:bound` and can distinguish a settled value from a
   cut-off (a dev-mode warning names `live()`); the body then closes. An
   ended-without-`complete` body stays what L1 makes it today (the open
   frame's `:error` — truncation observable). The client cost is one
   store key (≈ 20 B); the field is additive wire (RFC 11 addendum). Without
   a bound a plain response over a generator holds the connection as long
   as a `live` one does, with none of `live`'s reconnect semantics — the
   worst of both.
5. **Merge S1 as built, first (step 0), with a Size-Exception for the +134
   frames-eager overage retired by step 2?** — **Recommend yes** (§5).
6. **The adopt-path holds (traces, regions, bind) register as pending
   boundaries through `initBoundaryResume` (3.1 participants), with the
   solid-side reach (`sharedConfig.resumeBoundary`, `hydrateWindow`) paid by
   every hydrating page at ≈ +40–50 br, and the compiled-hydrating cap
   raised accordingly?** — **Recommend yes.** It is the ruling (3.1, 3.2),
   and it is what bounds bind's dead-handler window (§1). The alternative —
   plain waits — is what the ruling rejects (a private notion of done).
7. **`preserveModules` for `solid-js` / `@solidjs/web` (audit S2 / C) as
   step 10's enabler, so the store hydration adapters and B.3's
   `staticElement` can leave the flat dists?** — **Recommend yes, after the
   tiers**, not before: it is 0 B on every single-entry scenario and only
   matters for what steps 5 and 8 leave behind on a page (≈ 1.3 KB of
   adapters, ≈ 2.4 KB of `dynamic`'s string tag).
8. **Claims + `frame:applied` ride the router's chunk rather than a frames
   tier?** — **Recommend yes**: 331 br, not worth a seam; the router is
   the only installer of `CLAIM_SEAM` and the only consumer of
   `frame:applied`.

---

## 7. Sources

- `documentation/plans/frames-a0-reattribution.md` (this branch, `d44f1c2b9`):
  §0 rubric, §1 classes and §1.3a the E.a split, §2 the measured floor
  (`L8`, `T+holes`, `Tglue`, `Tglue+holes`, `TF`), §2.4 the contract's reds
  under T-only, §3 tiers and compositions, §5 the seams, §5.3.
- `documentation/plans/sc-layer-audit.md` (`size/sc-audit` @ `0bb67ff38`):
  §5 packaging baseline (B.2 / B.3 / E.a / E.b / E.c measured), §6.1
  floors, §6.3 the compatibility surface, §6.4 the test corpus and its gaps,
  §6.5 S0–S10 (superseded here), §7 Q4 / Q5 / Q7.
- `documentation/server-components/frames-rulings.md` (`spec/frames-rulings`
  @ `757aba41c`): the Principle and corollaries 1–4; rulings 1.1–1.6,
  2.1–2.4, 3.1 (ruled 2026-10-05) – 3.6; "Order of work" (steps 1–9 and the
  pins each flips); "Public surface these fixes touch".
- `documentation/server-components/server-components-principles.md` (same
  branch): §2 A0; §4 rows 3, 14, 19; §6 the ≤ 7,800 budget and the ratchet
  rule; the S1 note under DR-2's receiver.
- `documentation/server-components/frames-consistency-contract.md` (#3813):
  C1–C19, §Red R1–R10 (R7 = C13's wire delimiter, R9 = C18), the harness.
- `origin/size/s1-lazy-store-materializer`: `8629a93be`, `ef6147557`,
  `9927ddddd` (messages, changesets, the principles note, the scenario
  comments: page base 44,829 → 38,439, live 48,454 → 42,102, frames eager
  13,770 → 13,904; `container-trace.js` 24.3 KB / 7.86 KB br).
- Measurements: `tmp-tools/floor-results.txt` on this branch's worktree
  (not committed; re-attribution §7 reproduces them).
