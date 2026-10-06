# Frames savings pass — A0 deletions, server-announced tiers, the lazy materializer re-based (2026-10-06)

**Sequence ruled 2026-10-06: correctness first; tiers after.**

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
server-driven preload seam, the audit's §D) survive as this plan's Phases D
and B; S4–S6 (B.2, B.3 + E.c, E.a + E.b) are re-cut here along the §1.3a
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

| tier                     | the race (what arrives before what)                                                                                                                                                                                                     | symptom if lost                                                                                                                                                                                    | bound                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | class                                                                                                                           | pin                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **holes** (E.a1)         | a `hole` / `attr` chunk — or an op on the document's `sc:live` stream — arrives before `tier-holes.js` has loaded. Always after the frame's first flush (holes are later yields; the markup that carries the `lh:` markers came first). | the frame freezes at its first yield (wrong content, silent).                                                                                                                                      | **buffer, no hold.** Stream face: `chunkToRecords` writes `hole:<k>` / `attr:<k>` into the store regardless; `#flush`'s hole pass runs only when the tier is resident, and records it cannot apply **stay pending** (store-model: any later flush retries). The tier's load triggers one `flush()` on every registered frame. Document face: the `sc:live` `ReadableStream` buffers until `pumpLiveChannel` runs (after the load); the op log replays to adopters. The announcement (§2) starts the fetch at the header / at t = 0, so in practice the chunk is resident before the first later yield.     | runtime wait                                                                                                                    | **existing:** C13 control arm (one hole alone applies), C18's pump-catch-up arm (ops before the adopter replay). **New:** `tier-holes-buffer.spec` — (a) stream: a `hole` chunk delivered before the tier resolves applies after it, nothing applied twice; (b) document: ops written to `sc:live` before the pump starts land after it; (c) a frame disposed during the wait applies nothing. The 3.1 question does not arise (post-first-flush).                                      |
| **live wire** (E.a2)     | a `live()` loop's first response (SSE framing, `LIVE_WIRE` in the call context) reaches `handle` before `tier-wire.js` has loaded.                                                                                                      | the response is read as a plain frame stream: no join/hold, no reconnect with a have-list; a reconnect lands as a full snapshot (today's post-adoption connect already does). Degraded, not wrong. | **preload-at-call.** `live(fn)`'s client decorator fires a hook the frames client installs (`configureServerFunctionsClient({ onLive })` — frames already imports `configureServerFunctionsClient`, so the dependency direction holds) that calls `prepareTier("wire")` **before** the first `fetch`; `handle`'s `LIVE_WIRE` arm awaits the same promise before reading the body, so a live connection without the chunk is impossible by construction. No buffer, no hold.                                                                                                                                | runtime wait (none in practice — the import and the request race only against each other, and the dispatch awaits the import)   | **existing:** the live suite (`server-functions-live-*`, `frames-live-*`; `live` is 22/61 branches covered — the audit's hot spot, §6.4). **New:** `tier-wire-preload.spec` — the first live response is held until the tier resolves; a response that completes before the tier never reaches the plain reader; `resume` sends the have-list on the first reconnect.                                                                                                                   |
| **traces** (S1 re-based) | an adopt-time record whose literal args carry a `{ $tr, $ta }` marker — or a `data` chunk whose node tree holds the trace plugin's node — before `container-trace.js` (the materializer + the store engine) has loaded.                 | the fill runs with an inert marker object (`TypeError` or wrong content); on the codec face the chunk decodes a marker instead of a container.                                                     | **announce + hold.** Document: the server knows it serialized a trace (the serializer stamps it) → `modulepreload` at t = 0 + the `sc:tiers` record; the occurrence is **held** (S1's `#argsUnprepared` → the general held set) with its server interior on screen, the mount being the hydration attach; it mounts with the record it was held on (S1 commit 3). Codec: `prepareData` scans the node tree and awaits the tier before the chunk decodes (S1 as built; the header flag makes the scan a confirmation). The claim reads the snapshot; the backlog lands after done (3.6 (iii), S1 commit 3). | **3.1 participant** (document face: the hold is an adopt-time occurrence deferred — registers through `initBoundaryResume`, A2) | **existing (S1):** `frames-container-lazy-codec` (loads before decode / loads nothing), `frames-container-lazy-document` (held with the interior on screen, then mounted), `hydration/welcome-status-lazy` (claims in place, no key misses), `container-trace-hold-{id-determinism, interruption, record-retention, snapshot}`. **Re-pin:** `container-trace-hold-hydration-end` under 3.1 — _hydration waits for the load; the mount claims before done_ (rulings 3.1 "Consequences"). |
| **regions**              | a `slot:` record naming a `{$frame}` ref — or a `data-fid` region element inside adopted content — before `tier-regions.js` has loaded.                                                                                                 | the fill receives the raw `{$frame}` ref (wrong content); an occluded region cannot mount from the store.                                                                                          | **announce + hold.** The sink knows at render it passed server content as a prop (`{$frame}` minted) → announced. Adopt path: the occurrence is held in the same set as traces (its interior stays on screen; `#resolveArgs` runs after the load). Stream path: the record stays pending in the store until the load's flush (buffer).                                                                                                                                                                                                                                                                     | **3.1 participant** on the adopt path; runtime wait on the stream path                                                          | **existing:** `frames-regions-*`, the lifecycle matrix's region rows. **New:** `tier-regions-hold.spec` — adopt-time `{$frame}` occurrence held, interior intact, mounts after the load with the held record; a stream record with a region ref applies after the load; hydration-done waits (3.1).                                                                                                                                                                                     |
| **assets**               | a `reveal` for a segment whose `seg:<k>:assets` record names stylesheets (or `waitForStyles`) before `tier-assets.js` has loaded. Stream face only — the document face keeps the core's `$dfs`.                                         | **without a bound: FOUC** — the segment reveals unstyled, then the sheet lands. With the bound: the fallback stays on screen longer.                                                               | **announce + reveal-readiness term.** The sink knows at render that a fragment is style-gated → announced in the header; `#segmentReady` gains one term: "the segment's `assets` record names styles **and** the tier is not resident → not ready". The fallback — the server's `<Loading>` outcome — stays; the reveal happens at max(tier load, stylesheet load), and the stylesheet's own load dominates on every network. A segment without stylesheets never waits. Modules / preloads / inline styles are not reveal-gating today and stay so.                                                       | runtime wait (the segment swap is post-first-flush)                                                                             | **existing:** `frames-assets-*` (`waitForStyles`, the style gate; note `ensureStylesheet` / `applyInlineStyles` have **0 client tests** — the audit's gap, to be pinned in C5 regardless of tiering). **New:** `tier-assets-ready.spec` — a `reveal` for a style-gated segment before the tier resolves keeps the fallback; reveals once the tier and the sheet are both in; an unstyled segment in the same stream reveals immediately.                                                |
| **binding slots**        | `_s:` markers (attribute / class / style / text positions, `_s:on:*` handlers, `_s:ref`) in markup — document or stream — before `tier-bind.js` has loaded.                                                                             | positions sit at the server's values (inert attributes, classes, text); **handlers are not attached — a click in the window is lost** unless the hydration event-replay window is still open.      | **announce + hold.** The sink knows at render it emitted `_s:` (binding positions are minted by the slot props' proxy) → announced at t = 0 / in the header. Adopt path: an occurrence with `ctx.positions` is **held** (same set), which keeps `_$HY.done` false and the delegated-event replay buffer open until attach — the click is replayed. Stream path: the occurrence stays pending in the store until the load's flush. The audit's §7 Q5 (one chunk load before a post-load stream's first binding) is accepted for B.3 and applies here.                                                       | **3.1 participant** on the adopt path; runtime wait on the stream path                                                          | **existing:** `frames-binding-slot-*`, `slot-positions-*`, the #3704 / #3714 suites. **New:** `tier-bind-hold.spec` — held occurrence's positions untouched until the load; attach after; **a click dispatched during the hold replays after attach**; hydration-done waits (3.1); a stream occurrence binds after the load.                                                                                                                                                            |

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
let `_$HY.done` flip and the click fall on the floor. C6 depends on A2's
S-hold for this reason — and by the ruled order A2 precedes every tier.

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
  resident (the held set — A2's registered set, keyed by occurrence and carrying
  the record it was held on; it is what S1's `#heldRecords` generalizes
  into when S1 re-bases at C3); `#segmentReady` treats
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
record read ≈ 30, the generalized held set ≈ 100 over A2's registration.
S1's two faces, +543 / +134, are never shipped — B precedes S1's merge, so
the ≈ −35 net the earlier draft credited here is C3's). Server ≈ +300–450
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

**Sequence ruled 2026-10-06: correctness first; tiers after.** The
maintainer's reasoning: each tier adds a timing seam, and seams are where
the contract found the engine unsound; a hold merged before ruling 3.1's
registration exists is a hold that does not count toward hydration-done —
the private notion of done the ruling rejects. So Phase A (the correctness
pass, itself the first savings step under A0) lands whole before any tier
ships; Phase B builds the one tier mechanism on top of it, so every hold
registers under 3.1 from day one; Phase C ships the tiers cheapest / safest
first, **S1 re-based as the traces tier, right after the mechanism — not
merged first as built** (§5 says why); Phases D and E are packaging and the
budget.

Each step is one PR off `next`. Gate = PR #3813's contract (named pins flip
to `test`, every other pin and the harness's laws stay green, the whole
frames / hydration suite green) **plus** `scripts/size` (every scenario ≤
its cap; the step's expected Δ stated in the PR; caps lowered at landing —
the ratchet; raises are the maintainer's, by Size-Exception) **plus** the
timing pins of §1 for any step that tiers. Δ columns: frames eager / page
base / page live / compiled hydrating (br unless marked). Chunk sizes are
what the step creates as lazy chunks (reported by the harness, not
counted). "Surface" items are flagged as their own line. Every byte figure
is the 2026-10-06 draft's measurement or estimate, unchanged; the old step
9's ≈ −350 / +45 is apportioned across A2–A5 (its parts) and sums to the
same; A0 and the 3e port in A2 carry the rulings' own prices (+15, +25).

**Phase A gate (all of A, before B starts):** every one of the twenty-two
contract reds **green or unrepresentable** — the three server-half arms
(C13 (a, b), C12 (c)'s server arm) are the only reds that may stand at the
gate, and only with A6's drafts attached and their server PRs opened; the
harness clean on **two seeds** with every law un-ignored; frames eager
**smaller than today** (13,770 → ≈ 12,300).

| #      | step                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Δ br (frames eager / page base / page live / compiled hydrating)                                                                                                                                                                                                                                            | chunks created                                                                                                                                                     | gates (pins flip; size)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | depends on                                                                                                                   | surface                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A0** | **C18 — classification waits for the drain** (rulings step 1, 3d / 3.5; **in flight**). The predicate is one term in `adoptBoundary.recordsPending`: a `prop#n` occurrence is classified only after every delivered record has drained. The only page-halting red; lands as the rulings specified it. A1 then makes the mechanism moot (one write per drain; `#` decides the class — C18 becomes unrepresentable) and the pins stay as the assertion of the pending read.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | **≈ +15 / +15 / +15 / 0** (the rulings' ≈ +50 min / +15 br; ≈ +25 br with the batched drain, which A1 supersedes)                                                                                                                                                                                           | none                                                                                                                                                               | **flip:** C18 ×3. Size: ±0.02 KB on every scenario (frames eager ≤ 13.8).                                                                                                                                                                                                                                                                                                                                                                                                                                                    | #3813 landed                                                                                                                 | none                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **A1** | **S-flush + the R deletions it unlocks.** `content = createMemo(() => host.landing(binding()))` — one reactive node per bound address resolved at the version's first root / error write (the host's `landing(address)`: a promise for a cold store, the value for a warm one); the enclosing `<Loading>` pends on it, a switch is a new flight (`_inFlight` supersession, 1.6 (i) by construction), a refetch's landing is staged by the Transaction that read it (G7 closes). Deletes: **R.gate** (`arm`/`release`/`settle`/`setGate`/`mountGate`, the adopted twin), **R.stage** (`stage` / `stageTables` / `stagedContent` / `CONTENT_TOKEN` / `STAGED_DATA` / `FrameImpl#preview` / `#regionsChange` / `host.preview`; the chunk buffer-until-`complete` stays, one write), **R.version** (2a: one applied record keyed by identity; `#appliedRoot`), **R.dedupe** (per-prop memos in `slotArgsProxy`; `argsEquivalent` / `#refArgsUnchanged` / `#slotResolvedRefs` go), **R.error**'s latch. Files: `frames/src/client.ts` (`boundaryComponent`, `adoptBoundary`, `followAddress`), `frame-transport.ts` (`stage*`, `handle`), `frame-client.ts` (`#apply`, `#flush`, `preview`, `#syncSlots`' dedupe arms). | **≈ −1,150 / ≈ −1,150 / ≈ −1,150 / 0** (`est.` from the measured R total −1,863 with every feature kept, scaled to the 4,170 of 6,655 R-min these groups are; S-flush's own glue ≈ +110–190 min / +40 br is inside this)                                                                                    | none                                                                                                                                                               | **flip:** C5 (a, b, e) with the per-response data cell (1.2), C6 (b2), C7 (c), C17 (a); **C17 (c) re-pins** to 1.6 (i) `waiting → B`; C6 (b1) inverts (asserts the opposite of A0). Size: frames eager ≤ 12.7 KB (from 13.78), page base ≤ 43.7, live ≤ 47.5.                                                                                                                                                                                                                                                                | A0                                                                                                                           | **removed / changed:** `ServerComponentHandlerOptions.onStream`, `FrameHostOptions.resolve` / `FrameHost.resolve`, `FrameHost.preview` / `Frame.preview`, `STAGED_DATA` — the rulings' step-4 list. **New:** `FrameHost.landing(address)` (internal).                                                                                                                                                                                                     |
| **A2** | **C3 via `initBoundaryResume` — S-hold** (the rulings' 3a, pulled forward: **this is what lets any later hold register**). `hydrateWindow(id, fn, roots?)` factored out of `resumeBoundaryHydration`; `initBoundaryResume`'s registration reachable from the adopter (`sharedConfig.resumeBoundary`); `adoptBoundary` registers the adopted frame's owner while `#syncSlots` leaves any adopt-time occurrence deferred (the held set — one registration per frame, 3.2) and releases when a sync leaves none or the frame disposes. The #2968 `setTimeout` poll becomes the registration with the drain's end as its bound (3.5); the resumed fill re-enters hydration through the window and claims under the producer's keys (C1 / C9 stay green). **With it, 3e ported onto `next`** (the detached root + the parked backlog beyond the snapshot, 3.6 (iii), without S1's `claiming` plumbing — the rulings' "else ≈ +90 / +25" arm, because S1 no longer lands first and the Phase A gate counts C19), and 3.2's release order (claim → hold release → done → backlog) pinned. Deletes **R.claim** (the range-scoped registry beside `gatherHydratable(el, root)`) and the counter half of **R.drain**. **Landed in two parts** — #3837 (`holdBoundary`) and #3840 (`hydrateWindow` + the R.claim deletion; the park unconditional, rulings 3.6 "Landed") — measured **frames −109 br / hydrating +105 br** against the −130 / +40 estimate; the maintainer accepted the hydrating cost (2026-10-06; caps raised under a Size-Exception at the next integration PR), and **every further solid-side seam (S-adopted next) is to be measured on an edited dist copy before it is written.** | **≈ −130 / ≈ −130 / ≈ −130 / ≈ +40** (`est.`: R.claim ≈ 472 min + R.drain's defer ≈ 270 min ≈ −215 br of cuts; the registration ≈ +100 min frames ≈ +60 br incl. the `hold` option; the 3e port ≈ +90 min / +25 br; solid `hydrateWindow` + the reach ≈ +40–65 min ≈ +12–20 br, the detached root ≈ +20 br) | none                                                                                                                                                               | **flip:** C3 (a) + the harness's C3 replay; C19 ×2 (3e); S1's C3 (b) flips at C3 (the traces tier). Size: frames eager ≤ 12.55; **app hydrating / compiled hydrating +≈ 40 br — the first cap raise, the maintainer's** (compiled hydrating is at its cap on this head: 30,943 vs 30.93 KB).                                                                                                                                                                                                                                 | A1 (the deferred set is right only once the drain is one write and the landing node exists)                                  | **solid:** `sharedConfig.resumeBoundary` or an `internal` export of the registration — no new counter, no new done path (3.1 ruled; the draft's `holdHydration` withdrawn); the detached projection root (3e). **frames:** `FrameOptions.hold(): () => void` (internal, wired by `adoptBoundary`).                                                                                                                                                        |
| **A3** | **C2 / C4 — a reveal is an apply (S-reveal, interim 2b).** `fr.subscribe((_, parent) => el.contains(parent) && frame.sync(parent))` — a document `$df` into adopted content syncs the frame (2.3, 2.4); a bare `children` mounts at the revealed range (C2 b); a `#`-named occurrence found recordless is a pending read (C2 a2, through A2's hold). Deletes **R.reveal**'s readiness / retry model (`#segmentReady`'s retry loop, the `#revealed` / `#fallbackShown` second set) — the segment swap's DOM half stays (T.morph). DR-4's structural form (2c, the document fragment as a store write) is its own plan and not this step.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | **≈ −115 / ≈ −115 / ≈ −115 / 0** (`est.`: R.reveal 467 min ≈ −140 br; the one-liner +58 min / +23 br, measured as `Tglue-reveal` − `L8`)                                                                                                                                                                    | none                                                                                                                                                               | **flip:** C2 (a2, b) + the harness's C2 replay; C4 (d) (the ledger is the store; the drain is one write). Size: frames eager ≤ 12.45.                                                                                                                                                                                                                                                                                                                                                                                        | A1, A2                                                                                                                       | a `Frame` sync hook for the document reveal — internal, through the spread-cast options seam `adoptBoundary` already uses (rulings' list)                                                                                                                                                                                                                                                                                                                 |
| **A4** | **C5 / C6 / C17 residue — S-record, S-ref.** **S-ref:** the codec table answers an undelivered `{$ref}` with a pending promise rejected at `complete` / `:error` (L1 — closes the silent-ref hole, re-attribution §5.3 item 1); a record's refs resolve through the table current at its apply (1.3) — the per-response data cell (1.2, ≈ 140 min, replacing `stageTables`) that A1 left as the C5 condition. **S-record:** the server half — the document sink writes `sc:slot:<fid>:<occ>` as a **declared** pending ref at the marker (as `registerFragment` writes `<id>_fr`) and settles it with the args, so `readHydratedValue`'s `.then` path carries the wait — or the solid write hook on `_$HY.r` (+40 B); either removes the poll's last reason. Deletes **R.refwait** (`#refsUnresolved`, the threaded `resolve`) and the poll half of **R.drain**.                                                                                                                                                                                                                                                                                                                                                   | **≈ −15 / ≈ −15 / ≈ −15 / 0** (`est.`: R.refwait 145 min + the poll ≈ 120 min ≈ −75 br; the cell ≈ +45 br + reject-at-complete ≈ +15; decode chunk +≈ 60 B min for pending-on-missing — lazy, not counted)                                                                                                  | `decode.js` +≈ 60 B (S-ref)                                                                                                                                        | **flip:** C6 (a1); C5 (a, b, e) if A1 shipped them conditional; C17 (c) confirmed under 1.6 (i). Size: frames eager ≤ 12.45 (±).                                                                                                                                                                                                                                                                                                                                                                                             | A1 (the landing node), A2 (a pending read is a hold)                                                                         | **server:** the declared slot record (output shape, +≈ 30 B/record) **or solid:** the `_$HY.r` write hook (+40 B) — one of the two, the maintainer's pick (the declared record is recommended: it is A5's shape).                                                                                                                                                                                                                                         |
| **A5** | **C12 (c) client half + `claimRegionFragments` — S-adopted, S-key.** **S-adopted:** `_adoptedRoots: Set<Element>` in `hydration.ts`; `fragmentPolicy` swaps an unclaimed fragment after `_hydrationDone` when its `pl-` placeholder is inside an adopted root (`_$HY.fr.adopt(el)` / `unadopt(el)` from `adoptBoundary`, ≈ 30 B frames) — G4 closes and **`claimRegionFragments`** (R.claimant) deletes. **S-key:** `whenRevealed` published on `_$HY.fr` (+≈ 15 B solid) and the SC reference carries its covering fragment key (+≈ 30 B server); `installRevealHook`'s rescan and `boundaryWaiters` (D) collapse into `whenRevealed(key).then(...)`. **C12 (c) client half:** the adopted face shows what the server rendered (A0 withdraws the pin's expectation, 3.3); post-done the swap goes through S-adopted rather than freezing the fallback — the pin's **server half** (the sink's error markup) is A6's draft.                                                                                                                                                                                                                                                                                        | **≈ −65 / ≈ −65 / ≈ −65 / ≈ +5** (`est.`: R.claimant 153 min + `boundaryWaiters` ≈ 110 min + the rescan's rebind ≈ 80 min ≈ −95 br; frames glue ≈ +30 br; solid `_adoptedRoots` + `whenRevealed` ≈ +20 min net of the detached root already paid in A2)                                                     | none                                                                                                                                                               | **flip:** C12 (c) client arm (shows the server's outcome; swaps post-done); the G4 and G9 timing pins (new: `adopted-swap-post-done.spec`, `boundary-arrival.spec`). Size: frames eager ≤ 12.35; hydrating scenarios +≈ 5 (inside A2's raise).                                                                                                                                                                                                                                                                               | A2 (the adopted frame's registration is what `fr.adopt` keys off), A3                                                        | **solid:** `_$HY.fr.adopt/unadopt`, `whenRevealed` on `_$HY.fr`. **server:** the fragment key on the SC reference (+30 B of output).                                                                                                                                                                                                                                                                                                                      |
| **A6** | **Server-half drafts — design, no wire change in this step.** (i) **C13's sweep delimiter** (R7): a multi-record `FrameChunk` member `{ type: "ops", ops: [...] }` the sink emits per sweep and the client applies as one write — the only wire item in the rulings' list, drafted as an RFC 11 addendum with the client's one-write apply (A1's shape already applies a write atomically). (ii) **The plain-response streaming bound** (§6 decision 4): `complete` gains `bound: "yields" \| "time"`; the sink ends a plain response at the bound. (iii) **C12 (c)'s error template**: the document face renders a rejected server `<Loading>`'s error outcome into the fragment (3.3's server half) instead of the blank. Each is a design note + a `test.fails` pin written against the draft; the server PRs follow the drafts and flip C13 (a, b) and C12 (c)'s server arm — Phase A is taken as done when the drafts are reviewed and those PRs are open.                                                                                                                                                                                                                                                    | 0 (design)                                                                                                                                                                                                                                                                                                  | —                                                                                                                                                                  | the three drafts reviewed; pins written (`.fails`). **Phase A gate taken here:** 22 reds green / unrepresentable except the three server-half arms, drafts attached; harness clean on two seeds; frames eager ≈ 12.3 < 13.77.                                                                                                                                                                                                                                                                                                | A1–A5                                                                                                                        | **wire (drafted, not shipped):** the `ops` chunk member; `complete.bound`. Decision 4.                                                                                                                                                                                                                                                                                                                                                                    |
| **B**  | **The tier mechanism** (§2): `sink.needs(tier)` at the five mint sites; `X-Frame-Tiers` at first flush; `sc:tiers` record + `modulepreload` links on the document face; `prepareTier(name)` + `installTier`; the **held set is A2's registered set** — a tier's adopt-path hold is one more reason an occurrence is deferred, so it registers under 3.1 from day one. No tier is cut yet — this step is the seam alone, measured. S1's `prepareData` / `prepareArgs` are not in the tree (S1 has not merged); the general seam is built directly and S1 re-bases onto it at C3.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | **≈ +100 / ≈ +100 / ≈ +100 / 0** gross (`est.`); server ≈ +300–450 min. S1's two faces (+543 min / +134 br) are never shipped — the ≈ −35 net the earlier draft credited here appears at C3 instead, as "S1 re-based costs less than S1 as built".                                                          | none new                                                                                                                                                           | `tier-announce.spec`, `tier-prepare.spec` (new); artifacts re-recorded once. Size: frames eager ≤ 12.45.                                                                                                                                                                                                                                                                                                                                                                                                                     | **the Phase A gate**; A2 (the holds register), A1 (the `landing` node is what an installed tier's `flush()` wakes)           | **wire (additive):** `X-Frame-Tiers`, `_$HY.r["sc:tiers"]`, the links. Decision 3.                                                                                                                                                                                                                                                                                                                                                                        |
| **C1** | **Holes tier** (E.a1; cheapest, buffer-only). `tier-holes.js` = `#applyHole`, `#applyAttrs` (less its owned-position arms, which are bind's), `findLiveTarget`, the hole pass, `pumpLiveChannel` + the op log + `applyLiveOp`. The eager client keeps `chunkToRecords`' `hole` / `attr` cases (records must land in the store before the tier is resident) and a one-line dispatch in `#flush`. Under the **8.0 reading** this step is skipped and holes stay eager (§6 decision 1).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | **−546 / −508 / −508 / 0** (measured: `T+holes` → `L8`; page `T+holes` → `L8`; live page the same cut)                                                                                                                                                                                                      | `tier-holes.js` ≈ 1,900 min / **≈ 620 br** (`est.`: the 2,116-min cut as its own module + the install glue)                                                        | `tier-holes-buffer.spec` (new, §1); C13 control + C18 catch-up arms unchanged; `frames-live-holes-*`, `document-live-*` green through the tier. Size: frames eager ≤ 11.9.                                                                                                                                                                                                                                                                                                                                                   | B                                                                                                                            | none (the record shapes and `sc:live` are unchanged; the hole appliers were never exported)                                                                                                                                                                                                                                                                                                                                                               |
| **C2** | **Live wire tier** (E.a2; preload-at-call). `tier-wire.js` = `connections` / `hold` / the join-or-hold arm of `handle`, `resume` + `encodeHaveList` / `FRAME_HAVE_*`, the have-list ledger (`#have` / `have()` / `#recordHave` and the record fields that feed it), `applyFrames`' connection wiring + `connection.cancel`, `isEventStream` + the SSE reader selection, `deserializeStream`'s live arm. The eager client keeps a one-line `LIVE_WIRE` dispatch in `handle` and `bump`'s cancel hook (a no-op without the tier). `live()`'s decorator fires the `onLive` hook (set by frames through `configureServerFunctionsClient`) that calls `prepareTier("wire")` before its first fetch; the arm awaits it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | **−433 / −355 / −355 / 0** (measured: `T+wire` → `L8`; the live page keeps the chunk lazy — its eager measurement drops the same bytes)                                                                                                                                                                     | `tier-wire.js` ≈ 1,300 min / **≈ 470 br** (`est.`)                                                                                                                 | `tier-wire-preload.spec` (new); the live suite green; the audit's `live` branch gap (22/61) closed to ≥ 45/61 in the same PR (the tier's own tests). Size: frames eager ≤ 11.5; live page unchanged ±50 (the chunk is reported, not counted).                                                                                                                                                                                                                                                                                | B; independent of C1                                                                                                         | `ServerFunctionsClientConfig.onLive` (new, internal hook on `configureServerFunctionsClient`); `FRAME_HAVE_HEADER` / `FRAME_HAVE_BUDGET` are exported constants today and move to the tier's module — **re-export from the eager entry** to keep the surface, or flag the move                                                                                                                                                                            |
| **C3** | **Traces tier = S1 re-based** (§5; S1 merges **here**, not first). The materializer entry (`solid-js/internal/container-trace`) and `loadContainers` as S1 built them; S1's `prepareData` / `prepareArgs` / `#argsUnprepared` become B's `prepareTier("trace")` + A2's registered held set; the codec-face node scan stays as the un-announced fallback behind the header flag; the eager half of F.trace (`reviveContainerTraces` / `materialize` / `isContainerTraceMarker` / `isMaterializedContainer` / `setContainerTraceMaterializer` / `getFrameHost.revive`) moves into `container-trace.js`'s `installTier`, leaving a ≈ 150-min trigger. S1's commit 3 re-bases onto A2's park: the `claiming` hint (`revive(value, claiming?)`) and the held-record mount land here, the detached root and the backlog are already on `next`. **`container-trace-hold-hydration-end` re-pins under 3.1 at merge** (A2 is in). The +134 B frames exception S1 as built would have needed **never needs granting**: B's seam is already paid and the tier cut is a saving.                                                                                                                                                | **≈ −250 / ≈ −6,640 / ≈ −6,600 / 0** (S1's measured page savings −6,390 / −6,352 plus F.trace's eager half: 843 attributed, −289 measured as `T+trace` → `L8`, less the trigger ≈ −250; S1's +134 on frames does not recur — its two faces are B's seam)                                                    | `container-trace.js` 24.3 KB / **7.86 KB br measured** (S1) + the eager half (≈ +700 min / +200 br → ≈ 8.1 KB br)                                                  | S1's seven surviving pins green through the general seam (`frames-container-lazy-{codec,document}`, `hydration/welcome-status-lazy`, `container-trace-hold-{id-determinism, interruption, record-retention, snapshot}`); **re-pin** `container-trace-hold-hydration-end` (_hydration waits for the load; the mount claims before done_); **flip** S1's C3 (b); the `.fails` id-drift pin → 3.4 (3c). Size: frames eager ≤ 11.25; page base ≤ 36.0, live ≤ 39.8 (S1's caps 38.45 / 42.12 are superseded by these at landing). | B, A2 (the hold registers; the park is on `next`), A3                                                                        | S1's: `revive(value, claiming?)`, `setContainerTraceMaterializer(…, claiming?)`, the entry, `withStoreHydration` / `applyPatches` / `forwardIteratorReturn` `@internal` on the main entry; **not shipped:** S1's `prepareData` / `prepareArgs` (replaced by `prepareTier` before they exist on `next`). `reviveContainerTraces` / `setContainerTraceMaterializer` move behind the tier — **flag**: re-export lazily-resolving wrappers or accept the move |
| **C4** | **Regions tier.** `tier-regions.js` = `#bindRegions` / `#regionsFor` / `#discoverRegions` / `collectRegionElements` / `disposeRegions` / `makeFrameElement` / `isFrameRef`, the `{$frame}` arm of `#resolveArgs`, the `resolveSlot` / `resolveSlotRecord` / `removeSlotRecord` thread-up, `tableFor`'s prefix walk, `drainRecords`' `sc:region:` arm. The eager client keeps the `{$frame}` detection in `#resolveArgs` (one `isFrameRef` test → hold, registered). The rename machinery (`renameRegion` / `#reconcileRegions`, D) deletes outright — it is not moved.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | **−489 / ≈ −480 / ≈ −480 / 0** (measured on frames: `T+regions` → `L8`; pages `est.` at the same cut)                                                                                                                                                                                                       | `tier-regions.js` ≈ 1,900 min / **≈ 540 br** (`est.`)                                                                                                              | `tier-regions-hold.spec` (new); `frames-regions-*`, lifecycle matrix region rows green; principles §4 row 19 (the rename compensations) deleted with D. Size: frames eager ≤ 10.75.                                                                                                                                                                                                                                                                                                                                          | B, A2 (the adopt-path hold registers — no 3.1 gap to flag)                                                                   | none (`createFrameElement` stays eager — it is `@experimental` public API, re-attribution §5.3 item 5)                                                                                                                                                                                                                                                                                                                                                    |
| **C5** | **Assets tier.** `tier-assets.js` = `ensureStylesheet` / `ensurePreload` / `ensureModulePreload` / `applyInlineStyles` / `qualifierValue` / `findHeadElement` / `PRELOAD_QUALIFIERS` / `#processedAssets` / `#styleFlush` / the assets pass; the eager client keeps `chunkToRecords`' `assets` case, `host.write`'s `seg::assets` accumulate, and the `#segmentReady` term. **Pin the two untested functions first** (`ensureStylesheet`, `applyInlineStyles` — the audit's 0-coverage gap) in the same PR. Alternative under decision 2: S10's route-through-`web` instead of a tier.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | **−684 / ≈ −665 / ≈ −665 / 0** (measured on frames: `T+assets` → `L8`; the `noassets` full-client cut −665)                                                                                                                                                                                                 | `tier-assets.js` ≈ 2,400 min / **≈ 760 br** (`est.`)                                                                                                               | `tier-assets-ready.spec` (new, the FOUC guard); `frames-assets-*` green; the two new coverage pins. Size: frames eager ≤ 10.05.                                                                                                                                                                                                                                                                                                                                                                                              | B                                                                                                                            | none                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **C6** | **Binding-slot tier** (E.c; largest, last of the tiers — its fallback needs the 3.1 hold for the event-replay window, which A2 provides). `tier-bind.js` = `bindDataOccurrence` (+ `valuesFor` / `write` / `release` / `writeText`; its second diff layer above `assign` — ≈ 300 B, D — deletes rather than moves), `slotPositions` / `slotEntry` / `textPosition` / `consumersOf` / `consumersEqual` / `ownedPositions` / `morphOwnedClass` / `morphOwnedStyle` / `applyOwned`, the `_s:` branch of `collectSlots`, the consumer-rebind arm of `#syncSlots`, the owned-position arms of `morphAttributes` / `reconcileChildren` / `#applyAttrs`, the `ctx.positions` branch of `slotsFor`; **`assign` leaves the eager frames client with it** (the page then keeps `assign` only through `dynamic`'s string tag — B.3, D).                                                                                                                                                                                                                                                                                                                                                                                       | **−1,546 / −2,504 / −2,542 / 0** (frames measured `T+bind` → `L8`; pages: the audit's E.c measurement — `assign` leaves on the page too)                                                                                                                                                                    | `tier-bind.js` ≈ 5,000 min / **≈ 1,650 br** on frames (`est.`); on a page it carries `assign` as well (≈ +3,000 min / +900 br) unless B.3 has already made it lazy | `tier-bind-hold.spec` (new, incl. the click-replay arm); `frames-binding-slot-*`, `slot-positions-*`, #3704 / #3714 suites green. Size: frames eager ≤ 8.5 (both readings), page base ≤ 32.35, live ≤ 36.1.                                                                                                                                                                                                                                                                                                                  | B, **A2** (the hold registers; the replay window stays open); C3 (the `installTier` shape proven on the biggest chunk first) | none public (the `_s:` marker grammar is unchanged; `bindDataOccurrence` was never exported)                                                                                                                                                                                                                                                                                                                                                              |
| **D**  | **Packaging remnants from the SC audit, if still relevant after tiering.** **S2 / C** `preserveModules` for `solid-js` / `@solidjs/web` (0 on single-entry scenarios; the enabler): lets the store **hydration adapters** (≈ 2.6 KB min, the ≈ 1.3 KB br S1 fell short of B.2's floor by) follow the engine into `container-trace.js`, and lets **B.3** (`dynamic`'s string-tag branch lazy, `staticElement` behind the seam) take `assign` off the page. **B.3:** page −2,372 / −2,391 br (audit measured), frames 0. **E.b** (sf natural-encoding bodies, codec-args message, `Retry-After` / trailer parsing lazy): −65 frames / −476 base / −519 live (audit floor). **E.c's other half** is C6. **Lazy codec:** already a chunk (22,986 / 6,074) — nothing to do. **Claims + event** (F.claims, F.event, 331 br): not a frames tier — they ride the router's chunk (the router installs `CLAIM_SEAM`); the frames client keeps the ≈ 60-B seam.                                                                                                                                                                                                                                                               | **≈ −400 / ≈ −4,100 / ≈ −4,200 / 0** (`est.`: claims+event −331 frames; B.3 −2,372, the adapters ≈ −1,300, E.b −476 on page base)                                                                                                                                                                           | `dynamic-static.js` ≈ 8,000 min / ≈ 2.4 KB br; the sf natural-body chunk ≈ 1,600 min / ≈ 480 br; the router's claims chunk ≈ 900 min / ≈ 330 br                    | the audit's S2 band (single-entry scenarios ≤ ±50 B); B.3's hydration specs; `CLAIM_SEAM` tests with the router. Size: frames eager ≤ 8.1, page base ≤ 28.2, live ≤ 31.8.                                                                                                                                                                                                                                                                                                                                                    | C3, C6 (so what leaves with the engine and with `assign` is known)                                                           | B.3: `dynamic`'s string-tag branch becomes async-loading on first use (behaviour change accepted in audit §7 Q5 / B.3); the `CLAIM_SEAM` install moves to the router                                                                                                                                                                                                                                                                                      |
| **E**  | **Budget restatement — principles §6 as per-tier lines** (§4's table is the draft). One line per eager default (both readings written, one picked), one per tier chunk, the page lines, the ratchet rule unchanged ("a ceiling increase requires a new mechanism row citing its axiom"), `floor-caps.json` gains the tier chunks as reported-not-counted lines with their own caps.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | 0                                                                                                                                                                                                                                                                                                           | —                                                                                                                                                                  | `check-floor-caps` clean on `next`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | all                                                                                                                          | —                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

**Dependency check under the new order.** S-hold (A2) now precedes
everything that holds: B's held set is A2's registered set; C3's, C4's and
C6's adopt-path holds register from their first landing (the earlier
draft's "ship the hold as a plain wait first, flagged" for regions is
gone); S1's hydration-end re-pin is taken at C3's merge because A2 is
already on `next`; bind's click-replay arm (§1) is provable at C6 for the
same reason. Within A: A1 precedes A2 (the deferred set is right only once
the drain is one write and the landing node exists), A2 precedes A3 (a
recordless `#`-occurrence is a pending read through the hold), A3 precedes
A5 (the adopted swap and the reveal sync share the ledger subscription),
A4 needs A1's landing node and A2's hold. B depends on the Phase A gate,
not on any one of A3–A6, but lands after A6 by the ruling (no tier seam
before the correctness pass is whole). Within C the tiers are independent
of each other except that C6 wants C3's `installTier` shape proven on the
biggest chunk first. D depends on C3 and C6 (what left with the engine and
with `assign`).

**Cumulative size gates (frames eager br, 7.8 reading):** 13.77 → A0 13.8
→ A1 12.7 → A2 12.55 → A3 12.45 → A4 12.45 → A5 12.35 → A6 12.35 (**Phase A
gate: smaller than today by ≈ 1.45 KB**) → B 12.45 → C1 11.9 → C2 11.5 →
C3 11.25 → C4 10.75 → C5 10.05 → C6 8.5 → D 8.1. The end state (§4) is ≈
7.2–7.3 KB; the 8.1 gate after D leaves ≈ 0.8 KB for the parts of R and D
the floor removed that no step above names explicitly (the
re-attribution's §1.4 D list ≈ 318 br; the sf slice's live arm; the second
dispose map; `documentAddress` and the `_$SC` mirror) — they go in A1 and
A5 as their call sites vanish, and the gates tighten to the measured value
at each landing (the ratchet). Pages (KB br): base 44.82 → A1 43.7 → A5
43.4 → B 43.5 → C1 43.0 → C2 42.65 → C3 36.0 → C4 35.5 → C5 34.85 → C6
32.35 → D 28.2; live 48.58 → A1 47.5 → A5 47.15 → B 47.25 → C1 46.75 → C2
46.4 → C3 39.8 → C4 39.3 → C5 38.65 → C6 36.1 → D 31.8. Under the 8.0
ruling C1 is skipped; the 7.8 gates from C1 on read +546 (frames) / +508
(pages).

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
| `container-trace.js`      | **7,860 measured** (S1) → ≈ 8,100 with the eager half moved in; ≈ 8,800 if the adapters follow (Phase D) | announced                      | 3.1 participant (adopt path)      |
| `tier-regions.js`         | ≈ 540                                                                                                    | announced                      | 3.1 participant (adopt path)      |
| `tier-assets.js`          | ≈ 760                                                                                                    | announced                      | reveal-readiness term             |
| `tier-bind.js`            | ≈ 1,650 (frames); ≈ 2,550 on a page carrying `assign` until B.3                                          | announced                      | 3.1 participant (adopt path)      |
| `dynamic-static.js` (B.3) | ≈ 2,400                                                                                                  | first string-tag `dynamic`     | async first render (accepted, Q5) |
| sf natural body (E.b)     | ≈ 480                                                                                                    | first natural-encoding call    | none                              |
| `decode.js`               | 6,074 measured                                                                                           | first `data` chunk             | the chunk awaits it (today)       |
| router claims             | ≈ 330                                                                                                    | the router installs it         | re-sweep on install               |

Pages (br; the whole page, lazy chunks not counted):

| scenario                  | today (head / audit)      | after Phases A–C (correctness + tiers; `est.` from the measured `L8` page cuts + the seams)                                                                      | after Phase D (+ B.3, adapters, E.b) | vs today             | the SC audit's floors                                              |
| ------------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | -------------------- | ------------------------------------------------------------------ |
| page base                 | 44,823 / 44,762           | **≈ 32.3 KB** (`L8` page 30,901 measured + the adapters S1 leaves eager ≈ +1,300 + seams ≈ +150) — 8.0 reading ≈ 32.8                                            | **≈ 28.1 KB**                        | **−16.7 KB (−37 %)** | packaging only ≈ 31.4; S10 end ≈ 29.5–30                           |
| page live                 | 48,576 / 48,436           | **≈ 36.1 KB** (`L8` page live 34,620 measured + adapters + seams; the holes and wire chunks load lazily on this page and are reported, not counted) — 8.0 ≈ 36.6 | **≈ 31.8 KB**                        | **−16.8 KB (−35 %)** | packaging only ≈ 35.5; S10 end ≈ 33.5                              |
| app hydrating (no stores) | 17,705                    | **≈ 17,750** (+≈ 45: S-hold's `hydrateWindow` + the registration reach, S-adopted, `whenRevealed`)                                                               | unchanged                            | +45                  | — (the rulings estimated +8 for 3a alone; the other two seams add) |
| compiled hydrating        | 30,943 (at its 30.93 cap) | **≈ 30,990** (the same +≈ 45)                                                                                                                                    | unchanged                            | +45                  | **cap raise needed — the maintainer's**                            |
| frames eager              | 13,770                    | ≈ 7,600 (7.8 reading; the C6 gate is 8.5 before the residual R / D cuts land) / ≈ 8,150 (8.0)                                                                    | **≈ 7,250 / ≈ 7,800**                | **−6.5 KB (−47 %)**  | ≈ 10,500                                                           |

### 4.1 Measured (2026-10-06)

The Phase D estimates above, turned into numbers by a measurement pass on
edited dist copies over the `L8` / `T+holes` / `Tglue` floors (method: the
re-attribution §2.1). All br unless marked. Baseline `next` @ `49a8dca84`:
page base 44,864 / page live 48,527; the correctness pass #3837 measures
+18 base / +68 live against it. The tables above are left as the estimate
record.

- **Phase D components on `L8` (page base).** **B.3** (`dynamic`'s string
  tag + `staticElement` lazy): **−3,692** — not the −2,372 estimated on
  `L0`: on the tiered page `assign` has no importer left, so the whole
  attribute runtime leaves with it; B.3's full saving therefore depends on
  C6 and `preserveModules`. **Store hydration adapters: 0** — already out
  of `L8`; the plan's +1,300 was S1's shape (measured −1,063 on S1's own
  build). **E.b+** (natural-body encode arms, the codec-args message,
  `Retry-After`, the trailer error, the natural decode arms): **−462**.
  Cumulative on `Tglue`: page base **26,832** (7.8) / **27,400** (8.0);
  page live 30,514 / 31,071.
- **End state** including the pass and the still-estimated seam glue
  (+110–150: `prepareTier`, S-hold's solid reach, S-adopted /
  `whenRevealed`): **page base ≈ 27.0 KB (7.8) / ≈ 27.5 KB (8.0)**; page
  live ≈ 30.7 / ≈ 31.3 KB — live stays over 30 KB on either reading,
  dominated by `action` and the optimistic lanes (+8.4 K min of signals
  over base). Frames eager measured `Tglue` + E.b+: **7,304 / 7,840**, in
  the §4 bands.
- **Fixture caveat.** The page fixture is hand-written; a compiled page
  keeps ≈ 1 KB br of DOM runtime through its templates, so the realistic
  8.0 end state is ≈ **28.5 KB**.
- **Router.** `@solidjs/router@2.0.0-next.35` on page base adds **+12,137
  br** (+38,779 min: the router's own 28,008 min; the signals it retains
  +8,583 — `action` and the lanes; sf +1,188; web +1,137). The base case
  with the router at the Phase D end state is ≈ **39.7 KB (8.0)**. The
  30 KB target is stated against page base WITHOUT the router; with it the
  gap is the router's. Scenarios `page: base + router` / `page: live +
  router` are on draft #3838 (57,001 / 58,243 measured today).
- **Under 30 KB?** Page base: **yes on both readings**; the margin rests on
  B.3 — without it 8.0 is ≈ 31.1 KB, over. This is the measurement §6
  decision 1's ruling (8.0, holes eager) was conditioned on.

---

## 5. What S1 becomes

S1 (`size/s1-lazy-store-materializer`, three commits) is the prototype of
this plan's tier model: it built the lazy chunk, the hold, and the
consistency fixes for the one tier whose chunk is big enough to have
forced the question. Under the general mechanism:

| commit                                                                            | survives as-is                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | re-shapes under the general mechanism (B / C3)                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | pins                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1 — `8629a93be`** the lazy materializer via `solid-js/internal/container-trace` | the **entry** (its own dist entry, the `@internal` seams it reads back from the main module — `withStoreHydration`, `applyPatches`, `forwardIteratorReturn`; the server's inert stubs); `loadContainers` as the dynamic import kept external; the frames container plugin materializing at decode                                                                                                                                                                                                                                                                                                                         | `FrameHostOptions.prepareData(chunk)` → `needsContainerTraceMaterializer(chunk) && prepareTier("trace")` (the node scan stays as the un-announced fallback; the header flag makes it a confirmation); `prepareArgs(record)` → the general **held set** predicate (a marker literal is one of the three hold reasons: trace / `{$frame}` / `positions`); `#argsUnprepared` → the held set; the eager half of F.trace (`reviveContainerTraces`, `materialize`, the marker tests) moves into the chunk's `installTier` | `frames-container-lazy-codec`, `frames-container-lazy-document`, `hydration/welcome-status-lazy` — unchanged in assertion; their load trigger becomes `prepareTier`                                                                                                                                                                                                                             |
| **2 — `ef6147557`** caps lowered to S1's measured + 10 B                          | the **ratchet itself** (lowering at landing)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | the values re-set at each later landing; the frames-eager +134 exception S1 could not take is **never granted**: B's shared seam lands before S1 merges and costs less than S1's two faces (≈ −35 net, credited at C3)                                                                                                                                                                                                                                                                                              | `check-floor-caps` clean on `next`                                                                                                                                                                                                                                                                                                                                                              |
| **3 — `9927ddddd`** a held container-trace fill hydrates like a resident one      | **all three fixes**: the detached root for the projection (solid; id determinism); the parked backlog beyond the snapshot until `onHydrationEnd` with the `claiming` hint (`revive(value, claiming?)` → `reviveContainerTraces(value, claiming?)` → `materializer(marker, claiming?)`) — this is ruling 3.6 (iii), the rulings' step "3e" — the detached root and the backlog are ported onto `next` in A2, the `claiming` hint lands with S1 at C3; the held-record mount (an occurrence held on an unresolved ref or unprepared arg mounts with the record it was held on and applies a replacement as the args change) | the held-record mount **generalizes**: it is the mechanism every announced tier's adopt-path hold uses (regions, bind), not trace-specific — `#heldRecords` keyed by occurrence becomes the held set of B (A2's registered set); the park's release order (claim → hold release → done → backlog) is **pinned with 3a** (rulings 3.2 "Ordering to pin with it")                                                                                                                                                     | `container-trace-hold-{id-determinism, interruption, record-retention, snapshot}` — survive as-is; **`container-trace-hold-hydration-end` re-pins under 3.1** at C3's merge (A2 already in) (_hydration waits for the load; the mount claims before done_ — same claim assertions, opposite order); the `.fails` id-drift pin (a keyed sibling after a frame) is ruling 3.4's and flips with 3c |

**When it merges: at C3 — re-based, after Phases A and B. S1 as built is
NOT merged first.** The reason is the one the ruling turns on. S1's
`#argsUnprepared` hold is a hold, and on `next` today nothing lets a frame's
hold register as a pending boundary — ruling 3.1's registration (A2) does
not exist yet. Merged first, S1 would land a hold that does not count
toward hydration-done: `_$HY.done` flips while the fill is still waiting for
its chunk, exactly the private notion of done 3.1 rejects, and S1's
`container-trace-hold-hydration-end` pin asserts that pre-ruling order as
the expected behaviour. Each tier adds a timing seam, and seams are where
the contract found the engine unsound; the first tier to ship should be
the first to register. Re-based at C3, S1's hold is one more reason in
A2's registered held set, its hydration-end pin re-pins at merge (A2 is
in), its `prepareData` / `prepareArgs` surface is never shipped (B's
`prepareTier` precedes it), and the +134 B frames-eager exception never
needs granting — B's seam is already paid and the tier cut is a saving.
The cost of this order is deferring S1's −6.4 KB page saving behind Phases
A and B; the maintainer ruled the delay acceptable.

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
   **Ruled 2026-10-06: 8.0 — holes eager.** The maintainer's condition
   ("only if we can get that sort of size number") was checked by
   measurement (§4.1): the page-base end state on 8.0 is ≈ 27.5 KB br,
   under the 30 KB target with ≈ 2.4 KB of margin (≈ 1.5 KB on a realistic
   compiled page). The C1 holes-tier step is skipped; `T.holes` stays in
   the eager client.
2. **Assets: eager or tiered?** — **Recommend tiered, with the
   reveal-readiness term and the announcement mandatory for style-gated
   fragments.** Eager costs +684 br and puts the default over both
   readings; tiered costs latency bounded by the stylesheet's own load,
   with the server's fallback on screen meanwhile (no FOUC, no blank). If
   the maintainer wants no new latency term, the alternative is audit S10
   (route the mirror through `web`'s asset registry) — fewer bytes than
   eager, no tier, and it retires ≈ 750 B of untested mirror; it is the
   second-best answer, not a bad one.
   **Ruled 2026-10-06: tiered, with the reveal-readiness term.** S10
   (route the mirror through `web`'s asset registry) is the fallback if a
   latency term is later unwanted.
3. **Is the document `modulepreload` (+ the `sc:tiers` record + the
   `X-Frame-Tiers` header) acceptable wire?** — **Recommend yes.** All three
   are additive; an old client ignores them, a new client without them
   falls back to the hold / buffer and converges to the same DOM (pinned,
   B). The alternative — detection only, S1's model for every tier —
   makes every tier's first use a cold chunk load on the critical path
   (traces today: the materializer loads at the first record), which is the
   timing exposure the maintainer's condition is about. Announcement is
   what turns the register's races from "likely" into "theoretical".
   **Ruled 2026-10-06: yes** — `modulepreload` + `_$HY.r["sc:tiers"]` +
   `X-Frame-Tiers`, as additive wire.
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
   **Ruled 2026-10-06: yes** — `complete.bound: "yields" | "time"`;
   defaults 64 later yields or 30 s after first flush, the latter aligned
   to the request's `signal`; the dev warning names `live()`.
5. **S1 merges re-based, after Phases A and B (at C3) — not as built, not
   first?** — **Recommend yes** (§5): its hold must register under 3.1,
   which A2 provides; its hydration-end pin re-pins at merge; its
   `prepareData` / `prepareArgs` surface never ships; no Size-Exception is
   needed. The cost is deferring the −6.4 KB page saving until Phases A and
   B are in.
   **Ruled 2026-10-06: yes** — S1 merges re-based at C3, after Phases A
   and B.
6. **The adopt-path holds (traces, regions, bind) register as pending
   boundaries through `initBoundaryResume` (3.1 participants), with the
   solid-side reach (`sharedConfig.resumeBoundary`, `hydrateWindow`) paid by
   every hydrating page at ≈ +40–50 br, and the compiled-hydrating cap
   raised accordingly?** — **Recommend yes.** It is the ruling (3.1, 3.2),
   and it is what bounds bind's dead-handler window (§1). The alternative —
   plain waits — is what the ruling rejects (a private notion of done).
   **Ruled 2026-10-06: closed by #3837** in the `sharedConfig.holdBoundary`
   form, cost accepted (+59 B min on every hydrating page; "pay the cost
   for correctness"). The plan's `hydrateWindow` form (R.claim's deletion)
   is being attempted in A2b (`fix/frames-a2b-park-and-window`); if sound
   it supersedes the `holdBoundary` form before release.
7. **`preserveModules` for `solid-js` / `@solidjs/web` (audit S2 / C) as
   Phase D's enabler, so the store hydration adapters and B.3's
   `staticElement` can leave the flat dists?** — **Recommend yes, after the
   tiers**, not before: it is 0 B on every single-entry scenario and only
   matters for what C3 and C6 leave behind on a page (≈ 1.3 KB of
   adapters, ≈ 2.4 KB of `dynamic`'s string tag).
   **Ruled 2026-10-06: yes** — `preserveModules` after the tiers (Phase D).
8. **Claims + `frame:applied` ride the router's chunk rather than a frames
   tier?** — **Recommend yes**: 331 br, not worth a seam; the router is
   the only installer of `CLAIM_SEAM` and the only consumer of
   `frame:applied`.
   **Ruled 2026-10-06: yes** — claims + `frame:applied` ride the router's
   chunk.

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
