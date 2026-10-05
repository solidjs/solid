# Frames rulings — the three seams (2026-10-05)

**Status: proposed — maintainer ruling pending.** Nothing here changes an
engine. Branch `spec/frames-rulings` off `next` @ `01e80a601`; this document
only.

The frames/hydration consistency contract
(`frames-consistency-contract.md`, branch `spec/frames-consistency-contract`)
pinned seventeen invariants against `next` and found eight red: thirteen
`test.fails` under `packages/web/test/consistency/` across C2, C3, C4, C5, C6,
C7, C12 and C17, each diagnosed to a mechanism (its §Red R1–R8). The
server-components size audit (`documentation/plans/sc-layer-audit.md` §4, branch
`size/sc-audit`) separately listed the layer's duplicated seams: two dedupes,
two gates, two late-boundary waiters, two `_$SC` bootstraps, two version
spaces, two asset loaders, three region-rename sites, two reveal engines, and
`preview` re-implementing the args arm. The hypothesis this document tests is
that the reds and the duplicates are the same seams seen from two sides — that
each red is a question two carriers answer differently, and each duplicate is
a question asked twice because no ruling said who answers it.

The finding: **yes for every red but one, and for five of the nine duplicates
directly.** The reds cluster on three questions — which response owns a thing,
what a version bump resets, what hydration-done counts — and five duplicates
(the two dedupes, the two gates, the two version spaces, the two reveal
engines, `preview`'s data half) are the two-carrier answers the reds fall
between; each collapses under the ruling that decides its red. Two more (the
two late-boundary waiters, the two `_$SC` bootstraps) sit on the seams'
questions with no red to show for it and stay with the audit's S9. Two (the
asset-loader mirror, the region-rename sites) are outside the three seams —
the audit's S10/S7. The one red outside the seams is C13 (one sweep, one
frame), which needs a wire delimiter and is the server half's.

The form is the signals core's L2 section (`packages/signals/docs/SPEC-ASYNC-SEMANTICS.md`,
"The hold model — L2"): one-sentence rulings, the mechanism meant to carry
each today (`file:function`), the state it currently lives in twice, the reds
it decides. Where two readings are possible, both are stated with
consequences and one is recommended, as that section did. The method for
turning rulings into fixes is the carve's (`documentation/plans/size-reduction-carve-step1.md`
§40–§42): fix under the ruling, collapse the duplicated carrier into one, state
the bytes, flip the pins — not thirteen patches.

Vocabulary is the contract's (occurrence, claim, shows, quiescent, hold).
"Response" below means one HTTP response for one address, identified on the
client by the version the handler's `bump` stamped at its header; the document
is a response too — version 0, the t = 0 frame (DR-4).

## The seams, the reds, the duplicates

| seam | question | reds (pins that fail on `next`) | duplicates (audit §4) |
| --- | --- | --- | --- |
| **1. Response identity** | which response owns a record, a `{$ref}` wait, a data table, the shell gate | **C5** (a, b, e) a superseded response's late `data` lands in the current table — R4; **C6** (a1, b2) a held `slot:*` record outlives its response and resolves through the next one's data — R5; **C17** (a, c) the shell gate answers to the frame's registered address, which lags the binding — R8 | two table spaces (`tables` + `stageTables`' `staged`, 183 B); two ref-resolution paths (`host.resolve(ref, frameId)` + the `resolve` parameter threaded through `preview` → `#refsUnresolved`/`#refArgsUnchanged`/`#resolveArgs`/`#resolveRef`); two dedupes (`argsEquivalent` 217 B at apply, `#refArgsUnchanged` 534 B at sync — the first exists because refs are response-scoped and the store is not); two shell gates (`boundaryComponent` + the adopted face in `adoptBoundary`, ≈ 150 B duplicated); `preview`'s data half (the `resolve` it threads). _No red, same question:_ the `_$SC` bootstrap twice — the document's t = 0 address record reaches the mount by `documentAddress` scanning `_$SC.a` (audit S9) |
| **2. Applied state per version** | what a version bump resets; when a reveal is an apply | **C7** (c) a byte-identical v2 root never re-applies, so v2's segment waits for a placeholder v1 removed — R2; **C2** (a2, b) and **C4** (d) a fragment reveal into adopted content is not a sync trigger — R3 | two version spaces (`FrameImpl.#version` beside `store.version`; `rebase`, ≈ 60–100 B); applied state in seven fields reset at three sites (`#resetStreamState` ×5, `rebind` ×2, the root apply ×1), one of them (`#appliedRootValue`) reset at only one; two reveal engines (`web.js`'s `$df`/`$dfl` and the frame's `#revealSegment`/`#showFallback`, ≈ 1.3 KB on one side — DR-4); the #2978 cascade (`claimRegionFragments` + the `fr.subscribe` body ≈ 250 B) as the document face's half of a sync |
| **3. Hydration-done accounting** | what `done` counts; what a claim owes | **C3** (a) hydration reports done while an adopted occurrence is still deferred — R1; **C12** (c) a rejected server `<Loading>` the adoption claimed swaps to a blank, unsurfaced — R6; S1's **C3b** shape (the `prepareArgs` wait — held by S1's own pin as the *expected* order); S1's `.fails` (a keyed sibling after a document boundary misses its key) | the #2968 deferral (`recordsPending` + `#recordRefresh` arm + the drain hook ≈ 300 B), S1's `#argsRefresh` + `#heldRecords`, and the `{$ref}` wait's non-carrier: three hold kinds, two carriers, no shared accounting; `drainRecords` + `appliedRecords` (DR-4 row 20). _No red, same question:_ two late-boundary waiters (`boundaryWaiters` + `arrivals`, ≈ 150 B duplicated, resolved from one subscription — a hold already counted through the covering `<Loading>`'s `_fr`; audit S9) |
| outside | — | **C13** (a, b) one sweep, two frames — R7 (no pin file yet) | the asset-loader mirror (audit S10), the three region-rename sites (audit S7) |

Byte figures are the audit's (minified, page base, exact per function;
brotli ≈ 0.29× at this layer). Estimates below carry a sign per direction:
− for the collapse, + for the new carrier.

---

## Seam 1 — Response identity

The question every red here asks: a thing arrived — whose is it? Today the
answer is given by *where it landed* (the address's current table, the frame's
current id, whatever gate is armed), and the rotation that makes "current" mean
"newest" happens at different moments for different things: the table at the
header (`beginStream`), the record never (`slot:*` survives `clearStreamRecords`),
the frame's address at the commit (`rebind`, by the maintainer's ruling of
2026-10-04 — the switch is display, one reveal). Between those moments, a thing
from one response answers a question asked of another.

### 1.1 A response owns what it delivered

**A record, a `data` table and a `{$ref}` wait belong to the response that
carried them — never to the address, the frame or "whatever is current" — and a
later response for the address supersedes them wholesale: nothing from a
superseded response lands in the frame that shows the current one.**

- **Mechanism today.** The table: `client.ts:tables` is a `Map<address, table>`;
  `beginStream(address)` rotates by `tables.set(address, undefined)` and
  `ensureTable` creates lazily at *first use* — which `createFrameHost.apply`'s
  `data` arm performs with no version read (the transport restamped
  `chunk.version`; `applyData` never looks). The record: owned by the frame
  store and versioned at the store (`store.version`, `#version`), not per
  record; `clearStreamRecords` keeps every `slot:*`. The wait: a `continue` in
  `FrameImpl.#syncSlots` with no carrier; its answer is `#resolveRef(ref)` →
  `host.resolve(ref, this.#options.id)` → `tableFor(id)` — the frame's *current*
  id, so a `rebind` re-routes every held record to the new address's data.
- **Lives twice in.** `tables` + `stageTables()`'s `staged` (the staged
  response's table is the one case that already *is* response-owned — kept in a
  second map because the first is address-owned); `host.resolve` + the `resolve`
  parameter; `argsEquivalent` + `#refArgsUnchanged`.
- **Decides.** The frame of reference for 1.2–1.4; by itself it flips nothing.
- **Note.** The staged entry in `frame-transport.ts:createServerComponentHandler.stage`
  is already this ruling built for one case: a per-response object owning the
  response's chunks, data (`STAGED_DATA`'s `data`), and the moment they become
  the address's (`commit`). The ruling says every response is that shape; only
  the moment differs — the header for an unstaged response, the commit for a
  staged one.

### 1.2 A `data` chunk lands in its own response's table or nowhere

**The table is opened at the response's header, not at its first chunk, so a
superseded response's late chunk has a table of its own to fall into and never
becomes the current one.**

- **Mechanism today.** Lazy creation at first use (`ensureTable`); the version
  guard in `createFrameHost.write` covers record writes only — `data` bypasses
  the store and the guard (R4).
- **Decides.** **C5 (a)** v1's late `data` trailing v2's header; **C5 (b)** the
  rotation observed through `host.resolve`; **C5 (e)** A → B → A → B through
  `dynamic` while B's first body is open.
- **Carrier.** A per-response data cell `{ t: table | undefined }` created where
  the response begins (the handler's `handle`, at `bump`), filled at the first
  `data` chunk once the codec is resident (`prepareData` is awaited before it —
  ruling §3 11 — so the cell's lazy fill is the codec's, not the response's);
  installed as the address's current at the header (unstaged) or at `commit`
  (staged). The response's chunks reach the host through a per-response target
  whose `apply` routes `data` into *its* cell — the shape `stage`'s entry
  already has. Nothing stamps or compares versions on the data path: a late
  chunk fills a cell nothing reads.

### 1.3 A record resolves its refs through its own response's table, wherever the frame is bound

**A record held on an unresolved `{$ref}` is held on its response's data; an
address switch or a refetch does not re-route it, so it never resolves against
a later response's values, and the later response's own record replaces it.**

- **Mechanism today.** `#resolveRef(ref, resolve?)` — the host path by frame id,
  or the `resolve` the staged preview threads down. R5: after `rebind`, A's held
  record resolves through `tableFor(B)`; at a staged commit, `commit` installs
  v2's tables *before* replaying v2's chunks, and the replayed `start`'s flush
  resolves v1's held record through them.
- **Lives twice in.** The two resolution paths (host-by-frame-id and the
  threaded `resolve`): `createFrameHost.preview(chunk, resolve)`,
  `FrameImpl.preview(records, resolve, inherited)`, `#refsUnresolved(args, resolve)`,
  `#refArgsUnchanged(occurrence, record, resolve)`, `#resolveArgs(key, args, resolve)`.
- **Decides.** **C6 (a1)** switch during the wait, the new stream ordering
  `data → html → slot`; **C6 (b2)** refetch during the wait, v1's data never
  before the commit. (C6 a2, b1, c and the control already hold.)
- **Carrier.** The slot record carries its response's data cell (stamped by the
  per-response target of 1.2 as the chunk becomes records: `record.data = cell`);
  `#resolveRef(ref, record)` has one path — `record.data?.t?.resolve(ref)`,
  `undefined` meaning "not delivered", which is already the held state. The
  threaded `resolve` deletes with the second path; `host.resolve(ref, frameId)`
  and `FrameHostOptions.resolve` have no caller left. A document-face record
  (`drainRecords`, version 0) carries no cell: its args are inline literals, so
  nothing resolves.
- **Consequence for (a1), traced.** A's record stays in the frame store after
  the rebind, bound to A's cell; A's data never comes; `#refsUnresolved` stays
  true; B's `slot` chunk writes B's record over it (a different object with
  different refs — the write replaces); B's record resolves through B's cell and
  mounts once. For (b2): the replayed `start` bumps and flushes; v1's record,
  bound to v1's never-filled cell, stays held; v2's replayed `slot` replaces it;
  one mount.

### 1.4 A version bump drops what the previous version never applied

**Slot records outlive a bump only as the dedupe for *mounted* occurrences; a
record no mount applied belongs to its superseded response and leaves with it.**

Two forms; the maintainer picks.

- **Narrow.** `#resetStreamState` (the bump arm and `rebind`) deletes every
  `slot:*` record that is not some mounted occurrence's `#slotArgs` entry.
  Hygiene after 1.3 (a held record of a dead response otherwise sits in the
  store until the occurrence disappears) and belt-and-braces for C6: a dropped
  record cannot resolve through anything. ≈ +50 B.
- **Full — the store is one response's.** Every record of the previous version
  leaves at the bump (the host's `write` and the frame's `apply` alike); what
  preserves occurrence state across versions is the *mount's* applied state
  (`#slotArgs`, `#slotResolvedRefs`), which the sync's value compare
  (`#refArgsUnchanged`) already consults. Then the apply-time dedupe
  (`argsEquivalent` 217 B, the `slot:` arm of `FrameImpl.apply` ≈ 80 B) has
  nothing to compare against and deletes; `clearStreamRecords`' key filter and
  its `root` parameter go with it (≈ −60 B); the `seg::assets` accumulate stays
  (it is within one version). **Rests on A5 as the sink implements it:** every
  response carries the full record set for its content (the sink emits a slot
  chunk per called occurrence per stream; `frames-live` "the re-sent slot record
  is equivalent" pins a reconnect re-sending). If a producer may omit an
  unchanged record, the full form misclassifies the occurrence on the next
  non-adopt sync — recommend the maintainer confirm the sink's rule before
  choosing it. ≈ −350 B.
- **Recommend:** the full form, confirmed against the sink; it is the audit's
  S10 "one dedupe" falling out of the ruling rather than being chosen.
- **Open under either form:** a called occurrence (`prop#n`) found recordless
  on a *non-adopt* sync is invoked argless today (the #2968 defer is adopt-only;
  `#syncSlots`' comment calls the recordless-called case "the protocol's
  invariant broken"). RFC 11 fixes no order between `slot` and `html`; the sink
  emits the record "at the call, ahead of the markup". C6 (a1) orders
  `data → html → slot` and the contract calls it legal. Either the sink's order
  is the rule (pin it; the contract's (a1) ordering is then contrived and
  (a2) is the real arm) or the defer generalizes to every sync as a hold
  (3.2). Needs the maintainer; not decided here.

### 1.5 The shell gate is the bound address's

**A mount's gate is armed for one address and released only by that address's
first apply — content or error — through whatever is registered under it; while
a switch is delivered and not yet committed the frame is still the superseded
address's and its applies release nothing; the new address's first write
releases through the frameless waiter.**

- **Mechanism today.** `client.ts:boundaryComponent` — `arm`/`release`/`settle`/
  `setGate`, `onApply: () => { applied = true; settle(); }`; `followAddress`'s
  compute half re-arms and registers `{ apply: settle }` under the new address;
  its effect half `drop()`s the waiter and `rebind`s at the commit (ruling
  2026-10-04: the switch is display). R8 (a): between the two halves the frame is
  registered under A; A's late html fans to it; `onApply` → `settle()`
  unconditionally; `release` is by then the re-armed gate's. The rebind's place
  is **not** what this ruling changes — the 2026-10-04 ruling stands; what
  changes is that an apply from the frame is a release only when the frame is
  bound where the gate is armed.
- **Lives twice in.** `boundaryComponent` and `adoptBoundary` each build the
  gate (`release`, `arm`, `settle`, `setGate`, the `ownedWrite` signal, the
  memo) — ≈ 150 B duplicated; the waiter under the new address is a third
  half-carrier of "who may release".
- **Decides.** **C17 (a)** switch delivered while A is open: A's late
  html/complete leave the gate pending; B's first chunk releases it. (C17 b, d,
  control hold.)
- **Carrier.** One `shellGate()` helper used by both faces, owning the signal,
  `arm(address)`, and `settle(from)`; the switching state already exists — the
  waiter (`followAddress`'s `waiter !== undefined` between its compute and its
  effect) — so the frame's `onApply` releases iff no waiter stands, and the
  waiter's `apply` releases unconditionally. `FrameOptions.onApply`'s detail is
  unchanged (no `id` needs adding).

### 1.6 A switch keeps on screen what was on screen

**The gate's value is per bound address: a re-arm begins with no value, so the
boundary decides by its own state — content it had revealed stays through the
switch, a fallback it was showing stays until the new address's first write —
and the superseded address never reveals after the switch was delivered.**

- **Mechanism today.** `createMemo(() => gatePromise())` is one memo across
  addresses; R8 (c): A's html released the gate legitimately (A was the bound
  address, no switch delivered yet), so the memo holds the element; B's delivery
  re-arms it, and a memo pending *with* a value shows the value under
  async-holds-latest — the `<Loading>` drops its fallback for content that was
  never on screen, `waiting → A → B`.
- **Two readings.**
  - **(i) Per-address gate value** (this ruling). The memo over the gate is the
    address's: a re-arm for B is a fresh pending read with no prior value, so a
    boundary that has not revealed stays on its fallback (A29's boundary
    exemption: an unrevealed boundary catches, a revealed one holds), and a
    boundary that had revealed A keeps A through the hold — the normal switch
    shows no flash, (c) shows no A. Consequence: `waiting → B` in (c);
    `A → B` on a shown site, unchanged. Cost ≈ +80 B (the gate memo keyed by
    the bound address — recreated per address rather than written across
    addresses).
  - **(ii) Holds-latest is the display rule.** A re-armed gate pending with a
    value shows the value; (c) is re-pinned as display behaviour (A flashes
    for one morph) and leaves C17 for a display invariant, as the contract's
    R8 anticipated. 0 B.
- **Recommend (i).** The L2 model's own reason: A's release answers a question
  ("show A") the site had already superseded ("show B" was in flight when A's
  html landed — the source was pending); provenance (L2 ruling 5) says an
  answer to an older question does not reveal. The frames layer has no
  question stamps, but the per-address gate value is the same rule stated in
  the boundary's terms: a value computed for A is not a value for B.
- **Decides.** **C17 (c)** under (i).

### Fix shape — seam 1

| step | collapse (−) | carrier (+) | net (min B, est.) | pins that flip | touches |
| --- | --- | --- | --- | --- | --- |
| 1a — 1.2, data owned by response | `stageTables` 183; `beginStream` 32; `tableFor`/`ensureTable`'s lazy-create ≈ 84; `stage`'s `data ? … : streams` fallbacks ≈ 60 | per-response cell at `bump` + the unstaged per-response target (the staged entry's shape, smaller) ≈ 140 | **≈ −220** | C5 (a), (b), (e) | `ServerComponentHandlerOptions.onStream` (public: the rotation it signalled is now the cell's install — delete or redefine); `STAGED_DATA` (@internal) generalizes to every response |
| 1b — 1.3, record carries its resolver | `host.resolve` 53 + `FrameHostOptions.resolve` wiring ≈ 40; the `resolve` parameter across `preview` ×2, `#refsUnresolved`, `#refArgsUnchanged`, `#resolveArgs`, `#resolveRef` ≈ 70 | the stamp at chunk→records ≈ 40 | **≈ −120** | C6 (a1), (b2) | `FrameHost.resolve(ref, frameId)` / `FrameHostOptions.resolve` (public, experimental — no caller); `FrameHost.preview`/`Frame.preview` signatures (@internal) |
| 1c — 1.4 full, the store is one response's | `argsEquivalent` 217; the `slot:` arm of `FrameImpl.apply` ≈ 80; `clearStreamRecords`' filter + `root` ≈ 60 | — | **≈ −350** (narrow form: ≈ +50) | none directly; closes the C6 class | the sink's A5 rule must be confirmed (no wire change if it holds) |
| 1d — 1.5 + 1.6 (i), the gate | the second gate (`adoptBoundary`'s face) ≈ 150 | `shellGate()` helper's waiter check ≈ 20; per-address gate memo ≈ 80 | **≈ −50** (1.5 alone: ≈ −130) | C17 (a); C17 (c) under (i) | none public |
| **seam 1** | | | **≈ −740** (≈ −215 br) | 7 of the 13 | |

The audit's **S8** ("one apply path for staged content", ≈ −0.7 KB) splits
here: 1a/1b are its *data* half (`stageTables` folds into response-owned
cells; `preview`'s `resolve` threading goes). Its *markup* half — a staged
version held in the one store under a not-shown bit, `preview` becoming the
ordinary args-update arm — is S8 proper, is a restatement of rulings §3 71–75,
and is not decided here (audit §7 Q2).

---

## Seam 2 — Applied state per version

The question: a frame applied something under version *n*; version *n*+1
arrives — what does the frame still believe? Today "applied" is seven fields
reset at three sites, and one of them is reset at only one of the two sites
that bump the version. And "applied" is also asked of the wrong event: a record
applies when it *arrives* (the flush after a store write), not when the range
it names *appears* — so a reveal that brings no new record applies nothing.

### 2.1 The store is the truth; the applied state is a cache of it, keyed by version

**After every flush a frame shows the materialization of its store at the
store's version; what the frame remembers having applied — the root, the
reveals, the fallbacks, the holes, the assets, the error notice, the have-list
— is one record stamped with that version and replaced wholesale when the
version changes; nothing applied under a previous version is consulted under
the next.**

- **Mechanism today.** `FrameImpl.#flush` (the repeat-until-no-progress segment
  loop, the hole pass, the assets pass); the applied state in `#appliedRootValue`,
  `#revealed`, `#fallbackShown`, `#appliedHoles`, `#processedAssets`,
  `#errorNotified`, `#have`; reset by `#resetStreamState` (five of them), by
  `rebind` (`#version`, `#appliedRootValue`), by the root apply (`#have`).
  `#version` beside `store.version` is the second version space; `rebase()`
  exists to reconcile them after a seed. (`clearStreamRecords` clears
  `seg:`/`hole:`/`attr:` and `:error`; `:complete` is not in its set and
  survives a bump — §3 6's "exact record set that clears" clause, unpinned.
  Under the full form of 1.4 it leaves with everything else.)
- **Lives twice in.** The three reset sites; the two version spaces.
- **Decides.** The frame of reference for 2.2; by itself it flips nothing.

### 2.2 A version bump re-applies the root even when byte-identical

**The root is the version's: a shell that did not change still applies as the
new version's — it answers the gate and re-creates the placeholders the
version's segments reveal into.**

- **Mechanism today.** `FrameImpl.apply`'s bump arm calls `#resetStreamState()`
  but not `#appliedRootValue = undefined` — only `rebind` does, with a comment
  that argues exactly this ruling for the rebind case ("the new address's html
  may be byte-identical … the value-skip must not swallow the new stream's
  morph"). `#flush` then value-skips the root (R2); `#segmentReady("a")` fails
  `#findPlaceholder` forever. Staging commits through the same path and has the
  same hole.
- **Decides.** **C7 (c)** a v2 root byte-identical to v1's resets the segment.
  (C7 a — all 720 orders — and b hold; d is the differing-root control.)
- **Carrier.** One `#applied` record, `{ version, root, revealed, fallbacks,
  holes, assets, errorNotified, have }`, created fresh at every bump
  (`this.#applied = applied(v)`) and at `rebind` (`applied(undefined)`, plus
  the root record dropped — the one thing `rebind` does beyond a bump); there
  is no second site to forget. `rebase()` becomes `#applied.version = undefined`
  — or deletes, if the frame trusts the host's guard (the host already drops
  stale writes before fanning out, so the frame's `v < #version` arm is a repeat;
  whether the seed's version can out-rank a live counter in one per-address
  space is the audit's "two version spaces" question — flag, not decided).

### 2.3 A reveal is an apply

**Content that becomes shown under a version is synced as content that arrived
under it: a reveal into a frame's range — a frame segment or a document
fragment — re-walks the revealed range for occurrences and applies what the
store holds for them; "the record arrived" and "the range is shown" are one
event seen from two sides, and either one completes the pair.**

- **Mechanism today.** The stream face already does this: `#revealSegment`
  syncs its materialized content (`#syncSlots(materialized)` inside the reveal
  seam's `content()`). The document face does not: a `$df` into adopted markup
  notifies `adoptBoundary`'s `fr.subscribe`, which runs `claimRegionFragments`
  (#2978) and `drainRecords` (#2968) — a sync happens only if the drain finds a
  *new* record (`drainRecords` → `host.apply` → `#flush` → `#syncSlots`). R3: a
  reveal with no new record syncs nothing (C2 b, C2 a2 at reveal time); a record
  drained *before* the reveal ran its sync while the range was inside
  `<template>`, found no marker pair, and is never re-asked (C4 d).
- **Lives twice in.** The two reveal engines (DR-4): `web.js`'s `$df`/`$dfl`
  runtime for document fragments, the frame's `#revealSegment`/`#showFallback`
  for stream segments; one knows to sync, one does not. The #2978 cascade is
  the document engine's half-sync (claims and drains, but does not walk).
- **Decides.** **C2 (a2)** render-prop occurrence revealed after adoption, record
  after the reveal (the reveal's sync finds it recordless while the parser runs
  → the #2968 defer → the drain → the mount: the existing hold, now reached);
  **C2 (b)** direct-insert `children` revealed after adoption (recordless by
  design; the reveal's sync mounts it); **C4 (d)** drain-before-reveal (the
  record is in the store; the reveal's sync finds the marker pair).
- **Carrier.** Interim (no DR-4): the document face's reveal calls the frame's
  sync, reached from `adoptBoundary`'s `fr.subscribe` when `el.contains(parent)`
  — through the same spread-cast internal options seam `recordsPending`/
  `drainRecords` use today, or a `sync(root)` on `Frame` (public surface;
  flag). One care: `#syncSlots(root)` is already range-scoped
  (`collectSlots(root.firstChild, …)`) but the #2968 defer is full-sync-only
  (`!root` — the stream face's scoped sync targets a *detached* fragment a
  later full sync cannot reach), so the document reveal either runs a full
  sync or the scoped sync with the defer allowed for an attached root
  (`!root || root.isConnected`); otherwise C2 (a2)'s recordless occurrence
  would be invoked argless at the reveal instead of deferred. Structural: DR-4
  — the document fragment is a write into frame `""`'s store (`seg:<k>` +
  `seg:<k>:reveal`), `#flush` reveals it through `#revealSegment`, and the
  sync is the stream face's; one reveal engine, ≈ 1.3 KB on whichever side
  goes. DR-4 is its own plan (audit §7 Q6); this ruling says what it must
  satisfy.

### 2.4 Applied means shown

**A record takes effect when it changes shown content; a sync that finds no
range for it leaves it pending in the store, and a drain's dedupe records
delivery to the store, not application to the page.**

- **Mechanism today.** `adoptBoundary.drainRecords`' `appliedRecords` — the
  contract's R3 reads it as "marked applied so it can never apply again"; the
  record is in the frame store, so under 2.3 the reveal's sync applies it.
  `appliedRecords` is correctly a once-per-key *delivery* dedupe (the host's
  `apply` is what it guards against repeating) and needs no change; this ruling
  names what it is so C4's "applies exactly once" is read against the page.
- **Decides.** The reading of **C4 (d)**; the fix is 2.3's.

### Fix shape — seam 2

| step | collapse (−) | carrier (+) | net (min B, est.) | pins that flip | touches |
| --- | --- | --- | --- | --- | --- |
| 2a — 2.1 + 2.2, one applied record | `#resetStreamState` 115 → ≈ 45; `rebind`'s two resets ≈ 40; seven field declarations → one ≈ 30; `rebase` 24 → ≈ 15 | the record constructor ≈ 60; longer member paths in `#flush` ≈ 50 | **≈ −70** (≈ −130 if `#version` folds into the host's guard — pending the `rebase` question) | C7 (c) | none public |
| 2b — 2.3 interim, the document reveal syncs | — | the `fr.subscribe` → scoped-sync call ≈ 40; exposing the sync ≈ 30 | **≈ +70** | C2 (a2), C2 (b), C4 (d) | a `Frame` method or an internal options hook (flag if public) |
| 2c — 2.3 structural, DR-4 | one reveal engine ≈ 1.3 KB on one side; the #2978 cascade ≈ 250 | the document ledger as frame-`""` store writes (unestimated) | its own plan | the same three, by construction | the document runtime (`$df` family); artifacts re-recorded |
| **seam 2 (2a + 2b)** | | | **≈ 0** (≈ −70 + 70) | 4 of the 13 | |

---

## Seam 3 — Hydration-done accounting

The question: hydration said done — done with what? Today `_pendingBoundaries`
counts `<Loading>` registrations (`initBoundaryResume`) and nothing else;
`checkHydrationComplete` drains the moment the root pass ends and that count is
zero. The frames client defers claims four ways — the #2968 record defer (a
timer), the `{$ref}` wait (the next flush), S1's `prepareArgs` wait (a promise),
the late-boundary wait (a ledger subscription) — and registers none of them.
S1 pinned the resulting order as *expected*: "hydration completes while the
load pends; the late mount claims the server markup". The contract pinned it as
red (C3 a). Both cannot stand.

### 3.1 Hydration is done when every occurrence the document delivered has claimed or deliberately replaced its markup

**`_$HY.done`, `onHydrationEnd` and `isHydrationInProgress()` answer for the
page, not for the root pass: an adopted range whose fill has not run is not
hydrated, whatever deferred it.**

- **Mechanism today.** `solid/src/client/hydration.ts:checkHydrationComplete`
  (`!_hydratingValue && _pendingBoundaries === 0`), `drainHydrationCallbacks`
  (`_hydrationDone`, the `flush()`, the callbacks, then on a timeout
  `verifyHydration`, `_$HY.done = true`, `registry.clear()`),
  `isHydrationInProgress` (`!_hydrationDone && (hydrating || _pendingBoundaries > 0)`).
  `FrameImpl.#syncSlots`' deferrals touch none of it (R1).
- **Two readings.**
  - **(i) Done counts the page** (this ruling; the contract's C3). Every
    consumer of done — `clientOnly`'s swap, the refresh runtime's
    `isHydrationInProgress`, `onSettled`-style callbacks, dev's completion
    sweep, `registry.clear()` — sees a page whose adopted ranges are live.
    Cost: every hold must be bounded (L1) or done never comes; the frames'
    holds are — the record defer by `recordsPending` (document complete, no
    fragment left), the ref wait by the stream's `complete`/`:error`, the
    `prepareArgs` wait by the chunk load's settle or rejection, the
    late-boundary wait by exhaustion.
  - **(ii) Done is the root pass's and its boundaries'** (S1's pin). A frame's
    hold is the frame's business; the late claim re-enters hydration through
    `claimRender` (its own range-scoped registry, so `registry.clear()` does
    not hurt it); dev's sweep is taught to ignore held fills (S1 did this).
    Consequence: `isHydrationInProgress()` reads false while adopted ranges are
    inert; `clientOnly` under an adopted frame may swap to its client branch
    before the fill is live; the refresh runtime may treat a half-hydrated page
    as settled; `frames-late-boundary-client` "waits for a fragment still
    holding the element after hydration reports done" stays the model.
- **Recommend (i).** The signal exists for consumers that must not act on a
  page still being claimed; a frame's hold is exactly such a claim in
  progress, and the holds are already bounded. (ii) keeps the frames client
  from touching `hydration.ts` and costs nothing, but it makes "done" a
  statement about one of two claimants. The S1 pin (`container-trace-hold-hydration-end`
  "hydration completes while the load pends") re-pins under (i) to "hydration
  waits for the load; the mount claims before done" — the same assertions on
  the claim, the opposite assertion on the order.
- **Decides.** **C3 (a)** the #2968 record defer; S1's **C3b** shape (the
  `prepareArgs` probe — holds on `next` because `next` has no `prepareArgs`;
  on S1 it is this ruling's second arm).

### 3.2 Every hold the frames client takes is counted, once per frame

**The record defer, the `{$ref}` wait, the `prepareArgs` wait and any hold
added later take one count on the hydration runtime while the frame has an
adopt-time occurrence deferred, released when a sync leaves none or the frame
disposes.**

- **Mechanism today.** Three hold kinds, two carriers: `#recordRefresh` (the
  timer, #2968), S1's `#argsRefresh` (the promise) and `#heldRecords` (the
  record an adopt-time occurrence was held on — S1's "a hold is the t = 0
  mount deferred: when it lifts, claim with *this* record"); the `{$ref}` wait
  has no carrier (a `continue`). Each has its own wake-up and none has an
  account. The late-boundary wait is counted already — through the covering
  `<Loading>`'s `_fr` registration — and stays so; its two waiters
  (`boundaryWaiters`, `arrivals`) are the audit's S9 and not this ruling's.
- **Lives twice in.** The three retry triggers (legitimately different
  wake-ups; they stay) with no shared "is this frame holding" bit.
- **Decides.** The mechanism of 3.1; the second arm of C3.
- **Carrier.** `#syncSlots` already computes, per adopt-time occurrence, whether
  it deferred (every `continue` before the mount); the frame holds one count
  while that set is non-empty: at the end of the sync, `deferred && !this.#hold`
  takes it (`this.#hold = options.hold()`), `!deferred && this.#hold` releases
  it; `dispose` releases it. The hydration runtime exposes the count through
  `sharedConfig` (`holdHydration(): () => void` — increments `_pendingBoundaries`,
  the release decrements once and runs `checkHydrationComplete`), wired by
  `adoptBoundary` into the frame's options as `recordsPending`/`drainRecords`
  are. S1's `#heldRecords` is the natural set to count (it is exactly the
  adopt-time held occurrences with a record); the recordless defer joins it.
- **Ordering to pin with it.** S1 parks a trace's backlog beyond the snapshot
  until `onHydrationEnd` so the claim sees the markup it was rendered from. Under
  (i) the park's release moves later, never earlier: the claim is synchronous
  at the materialization (`prepareArgs` settles → sync → invoke → revive →
  materialize → claim), the frame's hold releases after that sync, done after
  the hold, the backlog after done. No deadlock; pin the order.

### 3.3 A claim is a promise to account for the outcome

**The adoption that claims a fragment's placeholder — so its swap may land —
owns what the swap delivers: settled content syncs (2.3); a rejection shows an
error at the position and surfaces; a claimed fragment never swaps to a blank,
and `fr.pending()` reading false never means "the page converged" while a
claimed position shows nothing.**

- **Mechanism today.** `adoptBoundary.claimRegionFragments` → `fr.claim(fragId)`
  for every `pl-*` in the region (#2978 — so the held-swap policy does not hold
  them forever); the ledger's `fragmentPolicy` swaps whatever template the
  document wrote. The server's error path for a post-flush fragment writes a
  blank content template (`sink.fragment(key, " ")`), activates it, and rejects
  `<key>_fr`. `hydratedCreateLoadingBoundary`'s `s === 2` branch (resume fresh,
  error to the nearest `<Errored>`) runs only for a boundary registered against
  `_fr` — a client twin; a server-only `<Loading>` has none, and the adoption
  claimed the placeholder without consuming the rejection (R6). The serializer's
  thenable swallows it. The page converges on an empty range, nothing logged.
- **Lives twice in.** The two reveal engines again: the frame's engine has an
  error arm (`seg:<k>:error`, the reveal seam's boundary throwing to the nearest
  `<Errored>`); the document engine has none for a server-only boundary.
- **Decides.** **C12 (c)**'s "not a silent blank; the rejection is surfaced"
  clause, on the client. Its "error fallback at the position" clause is a
  product question (below).
- **Carrier.** The claimant consumes the rejection: `claimRegionFragments`
  registers on `_$HY.r[<fragId>_fr]`'s rejection (or the ledger's settlement
  state) and, on rejection, declines the swap (keeps the fallback), writes the
  frame's `seg:<k>:error` record, reports in dev, and — if the ruling below
  says so — throws through the reveal seam's boundary to the nearest client
  `<Errored>`. Under DR-4 this is one arm of the one engine.

### 3.4 The client consumes what the server consumed

**The adopted component takes the same hydration ids the server's render of the
server component took, so a keyed sibling after a document boundary claims the
server's node.**

- **Mechanism today.** The server consumes root ids for the component
  (`NoHydration`'s owner in `serverOwned`; one when the component is the first
  child, two after a keyed sibling — per S1's note); the client's `adoptBoundary`
  consumes none. S1's `.fails` pin: `container-trace-hold-id-determinism` "a
  keyed sibling after the frame claims the server's node". Independent of any
  hold; pre-existing on `next`.
- **Decides.** That pin. A parity bug under C10's rule read one level up (the
  frame's own ids, not the fill's) — fix without a new ruling, but it needs the
  server's consumption pinned first (it varies by position), and the fix may be
  server-side normalization (the server half, §6.3) rather than a client
  mirror.

### Fix shape — seam 3

| step | collapse (−) | carrier (+) | net (min B, est.) | pins that flip | touches |
| --- | --- | --- | --- | --- | --- |
| 3a — 3.1 (i) + 3.2, one hold counter | the three hold kinds become one `deferred` set the sync already walks (S1's `#heldRecords` + the recordless defer); no bytes leave — the wake-ups stay | `sharedConfig.holdHydration` in `hydration.ts` ≈ 90 (the **hydrating** scenario pays ≈ +30 br); `#hold` take/release at the sync's end + the option ≈ 110 | **≈ +200** | C3 (a); S1's `hydration-end` spec re-pins (order inverted, claim assertions kept) | `FrameOptions.hold` (new option — public, experimental; flag); `sharedConfig.holdHydration` (internal) |
| 3b — 3.3 client minimum | — | the `_fr` rejection consumer per claimed fragment ≈ 120 | **≈ +120** | C12 (c)'s blank/surfacing clause | the position's error display is the product question; the server's blank-template error path is the server half |
| 3c — 3.4 id parity | — | client mirror of the server's consumption ≈ 40, or server-side normalization | **≈ +40** or 0 | S1's `.fails` | the server half if normalized there |
| **seam 3** | | | **≈ +360** (≈ +105 br) | 2 of the 13 + S1's two | |

---

## What the rulings do NOT decide

**Plain bugs under an existing rule — fix without a new ruling, under the
collapsed carrier.**

- **C7 (c)** — §3 6 already says per-response state resets on a bump;
  `#appliedRootValue` was missed. 2.2 is that rule stated so the carrier
  cannot miss again.
- **C17 (a)** — §3 70 already says the gate settles on the new address's first
  write; A's apply releasing it is a bug under 70. 1.5 names the carrier.
- **C5 (a, b, e)** — §3 10 already says `data` is response-scoped; lazy table
  creation at first use is a bug under 10. 1.2 names the moment.
- **S1's `.fails`** (3.4) — parity, under C10 read one level up; needs the
  server's consumption pinned.

**New rulings — the maintainer rules.**

- **1.3** a record resolves through its own response's data (today: through the
  frame's current id). **1.4** which form (narrow / full). **1.6** per-address
  gate value (i) vs holds-latest (ii). **2.3** a reveal is an apply (today:
  a non-event on the document face). **3.1** done counts the page (i) vs the
  root pass (ii) — S1's pin and the contract's pin contradict; one re-pins.
  **3.3** a claimant owns the outcome.

**Product questions — a different conversation before any fix.**

- **What a rejected server-only `<Loading>` inside a server component shows**
  (C12 c, 3.3): the nearest client `<Errored>` above the frame (the whole
  server component's position goes to its error fallback); the frame's own
  latch at the position (fallback kept, `seg:*:error`, diagnostic — no fresh
  error DOM, since no client boundary exists there); or a server-rendered
  error fallback in the fragment (the server half writes an error template
  instead of a blank — wire/server change, §6.3). The contract's "fresh error
  fallback at the position" is the first or third.
- **Settles-once projections crossing as a trace rather than a promise-of-
  snapshot** (S1's shape — a trace whose producer settles once still crosses
  as a live container with a backlog to park, and the fill's claim must see
  the snapshot the markup shows). Whether such a value should cross as a
  promise of its snapshot (no store engine, no park) is a wire/DR-2 question.
- **Whether crossing containers are live by default** — the same DR-2 tier
  question from the other side; decides how much of 3.2's `prepareArgs` hold
  a typical page ever takes.
- **Whether `slot` may trail `html` on the wire** (1.4's open item) — RFC 11
  fixes no order; the sink emits records ahead of markup; the contract's
  C6 (a1) assumes the reverse is legal. Decides whether the #2968 defer
  generalizes to every sync.

**The server half / wire (§6.3) — out of these rulings.**

- **C13** (R7, one sweep one frame): the wire carries no sweep delimiter (the
  server coalesces per binding, not per sweep); no client ruling can make two
  ops one frame. Server half.
- **3.3**'s error-fallback option three; **3.4**'s server-side normalization;
  **2c** (DR-4) re-records the 146 artifacts.
- **Nothing in seams 1–2's client steps changes the wire**: 1a–1d and 2a–2b
  read the same chunks, keys and markers; `onStream`/`resolve`/`preview` are
  client-side options and `@internal` signatures (flagged above as public
  surface, not as wire).

**Not these seams.** The asset-loader mirror (audit S10: route through `web`'s
registry via `client.ts`'s import edge — a style gate is a hold in the
contract's vocabulary, but it defers a reveal, not a claim, and is counted
through the fragment ledger already); regions as store substructure (audit
S7, the three rename sites); store eviction (§3 4). No red touches them.

---

## Order of work

Each step is one PR off `next`; its gate is the contract's pins — the step's
named `test.fails` flip to `test`, every other pin and the whole frames/hydration
suite stay green (`packages/web/test/consistency/`, and the harness when it
lands) — plus `scripts/size` (every scenario ≤ its cap in `floor-caps.json`,
the step's expected delta stated in the PR and the caps lowered at landing —
the ratchet). A step that lands outside its band is the finding, not a failure
to hide.

| # | step | rulings | pins flip | size expectation (min / ≈ br) | depends on |
| --- | --- | --- | --- | --- | --- |
| 0 | land the contract's pins and harness as `test.fails`/green | — | — | 0 | `spec/frames-consistency-contract` finishing |
| 1 | **2a** one applied record keyed by version | 2.1, 2.2 | C7 (c) | ≈ −70 / −20 on frames eager, both pages | nothing; smallest, self-contained in `FrameImpl` |
| 2 | **1a + 1b** response-owned data cells; records carry their resolver | 1.1–1.3 | C5 (a, b, e), C6 (a1, b2) | ≈ −340 / −100 | the `onStream`/`resolve` surface flagged and accepted |
| 3 | **1c** the store is one response's (full 1.4) — or the narrow form | 1.4 | none; closes the class | ≈ −350 / −100 (narrow: +50) | the sink's A5 rule confirmed |
| 4 | **1d** one shell gate; per-address value | 1.5, 1.6 | C17 (a); C17 (c) under (i) | ≈ −50 / −15 | 1.6's reading |
| 5 | **2b** the document reveal syncs (interim) | 2.3, 2.4 | C2 (a2, b), C4 (d) | ≈ +70 / +20 | nothing; DR-4 (**2c**) replaces it later as its own plan |
| 6 | **3a** one hold counter | 3.1 (i), 3.2 | C3 (a); S1's `hydration-end` re-pins | ≈ +200 / +60 (hydrating +30 br) | 3.1's reading; S1 landed (its `#heldRecords` is the set) |
| 7 | **3b, 3c** claim owns outcome (client minimum); id parity | 3.3, 3.4 | C12 (c)'s surfacing clause; S1's `.fails` | ≈ +160 / +45 | the product question and the server's consumption |

Expected end state after 1–6: **≈ −540 B min / ≈ −155 B br** on the frames
client with the full 1.4 (≈ −140 min / −40 br with the narrow form) — frames
eager, page base and page live all carry it — and **+30 br** on the hydrating
scenario; twelve of the thirteen pins flipped (eleven if 1.6 is ruled (ii)),
the thirteenth (C12 c) pending the product question. This sits inside the
audit's C' estimate (≈ −1.8 KB br for the whole rulings pass) as its
consistency half; S7–S10's remaining items (regions, the asset mirror, the
markup half of S8) are the size half and need no ruling here.

---

## Public surface these fixes touch (to be accepted before the step that touches it)

All `@experimental` or `@internal`; none is wire.

- `ServerComponentHandlerOptions.onStream(address, version, response)` — step 2:
  the rotation it signalled becomes the response's cell install; delete or
  redefine.
- `FrameHostOptions.resolve(ref, frameId)` / `FrameHost.resolve(ref, frameId)` —
  step 2: no caller once records carry their resolver.
- `FrameHost.preview(chunk, resolve)` / `Frame.preview(records, resolve, inherited)`
  (`@internal`) — step 2: the `resolve` parameter goes.
- `STAGED_DATA` (`@internal`) — step 2: generalizes from "the staged response's
  data factory" to "every response's".
- A `Frame` sync hook for the document reveal — step 5: new, or kept internal
  through the spread-cast options seam `adoptBoundary` already uses.
- `FrameOptions.hold(): () => void` — step 6: new option; `sharedConfig.holdHydration`
  internal.

`FrameOptions.onApply`'s detail, `FrameChunk`, the store record keys, the DOM
markers, the hydration data keys and the `_$SC` bootstrap are unchanged by
every step above.

---

## Sources

- `documentation/server-components/frames-consistency-contract.md`
  (`spec/frames-consistency-contract` @ `ed803885d`): C1–C17, §Red R1–R8, the
  pins' arms; `packages/web/test/consistency/c0{2,3,4,5,6,7}-*.spec.tsx`,
  `c12-*`, `c17-*` (13 `test.fails`).
- `size/s1-lazy-store-materializer` @ `9927ddddd`:
  `packages/web/test/hydration/container-trace-hold-{hydration-end,id-determinism,snapshot,interruption,record-retention}.spec.tsx`;
  `FrameImpl.#argsUnprepared`/`#heldRecords`/`#argsRefresh`.
- `documentation/plans/sc-layer-audit.md` (`size/sc-audit` @ `0bb67ff38`): §3
  rulings 1–75 (cited "§3 n"), §4 structural vs incidental, §6.3 the
  compatibility surface, §6.5 S7–S10, §7 open questions, Appendix A function
  sizes.
- `packages/signals/docs/SPEC-ASYNC-SEMANTICS.md` "The hold model — L2
  (2026-10-04)" rulings 1–9 (the voice; ruling 5 provenance cited at 1.6);
  `documentation/plans/size-reduction-carve-step1.md` §38 (the two-readings
  memo form), §40–§42 (rulings → fixes → re-pins → numbers).
- `documentation/server-components/server-components-principles.md` A1–A7, L1,
  DR-2, DR-4, §4 rows 6, 14, 19, 20, §5.2.
- Code on `next` @ `01e80a601`: `packages/web/frames/src/frame-client.ts`
  (`createFrameHost`, `FrameImpl.apply`/`preview`/`#resetStreamState`/`#flush`/
  `#syncSlots`/`#refsUnresolved`/`#resolveRef`/`#refArgsUnchanged`/`rebind`/
  `rebase`/`dispose`/`#segmentReady`/`#revealSegment`, `clearStreamRecords`,
  `argsEquivalent`), `client.ts` (`tables`/`ensureTable`/`tableFor`/`beginStream`/
  `stageTables`, `followAddress`, `boundaryComponent`, `documentBoundary`,
  `adoptBoundary` with `drainRecords`/`claimRegionFragments`, `installServerComponents`),
  `frame-transport.ts` (`createServerComponentHandler`: `stage`/`named`/`settled`/
  `bump`/`handle`, `applyFrames.drain`), `packages/solid/src/client/hydration.ts`
  (`_pendingBoundaries`, `isHydrationInProgress`, `onHydrationEnd`,
  `drainHydrationCallbacks`, `checkHydrationComplete`, `initBoundaryResume`).
