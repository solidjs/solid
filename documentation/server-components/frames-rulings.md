# Frames rulings — the three seams (2026-10-05)

**Status: proposed — maintainer ruling pending**, except **3.1, ruled
2026-10-05** (hydration-done follows non-SC Solid 2) and the **Principle**
below, which is the maintainer's (three statements, 2026-10-05); every other
ruling is re-derived from it and marked *recommended-by-principle* where the
principle decides a reading. Nothing here changes an engine. Branch
`spec/frames-rulings` off `next` @ `01e80a601`; this document only. **The gate
for every fix below is PR #3813** (the contract, its
twenty-two `test.fails`, its harness): a step lands when its named pins flip
and nothing else moves. **2026-10-06:** the correctness pass ran overnight
as draft PRs #3830–#3833 (see "As landed" under the order of work, and the
defaults it took under "What the rulings do NOT decide"); this document
rides with the first of them.

The frames/hydration consistency contract
(`frames-consistency-contract.md`, branch `spec/frames-consistency-contract`
@ `681c96684`, PR #3813) stated seventeen invariants, found two more with its
property harness (C18, C19), and pinned nineteen against `next`: eleven red,
**twenty-two `test.fails`** under `packages/web/test/consistency/` — fifteen
hand pins across C2, C3, C4, C5, C6, C7, C12, C13 and C17, seven harness
replays (C18 ×3, C19 ×2, and C2/C3 rediscovered once each) — each diagnosed to
a mechanism (its §Red R1–R10). The server-components size audit
(`documentation/plans/sc-layer-audit.md` §4, branch `size/sc-audit`)
separately listed the layer's duplicated seams: two dedupes, two gates, two
late-boundary waiters, two `_$SC` bootstraps, two version spaces, two asset
loaders, three region-rename sites, two reveal engines, and `preview`
re-implementing the args arm. The hypothesis this document tests is that the
reds and the duplicates are the same seams seen from two sides — that each
red is a question two carriers answer differently, and each duplicate is a
question asked twice because no ruling said who answers it.

The finding: **yes for every red but one, and for five of the nine duplicates
directly.** The reds cluster on three questions — which response owns a thing,
what a version bump resets, what hydration-done counts — and five duplicates
(the two dedupes, the two gates, the two version spaces, the two reveal
engines, `preview`'s data half) are the two-carrier answers the reds fall
between; each collapses under the ruling that decides its red. Two more (the
two late-boundary waiters, the two `_$SC` bootstraps) sit on the seams'
questions with no red to show for it and stay with the audit's S9. Two (the
asset-loader mirror, the region-rename sites) are outside the three seams —
the audit's S10/S7. The two reds the harness found after this document was
drafted both fall under seam 3: C18 is a hold whose release is read from the
wrong ledger (3.5 — the only page-halting red, first in the order of work),
C19 is a claim reading state that moved before it (3.6). The one red outside
the seams is C13 (one sweep, one frame): the contract's pin **confirmed** it
red on both faces with identical torn frames — no client-side unit larger
than one op exists — so it needs a wire delimiter and is the server half's;
the delimiter's shape is sketched in that list below.

The form is the signals core's L2 section (`packages/signals/docs/SPEC-ASYNC-SEMANTICS.md`,
"The hold model — L2"): one-sentence rulings, the mechanism meant to carry
each today (`file:function`), the state it currently lives in twice, the reds
it decides. Where two readings are possible, both are stated with
consequences and one is recommended, as that section did. The method for
turning rulings into fixes is the carve's (`documentation/plans/size-reduction-carve-step1.md`
§40–§42): fix under the ruling, collapse the duplicated carrier into one, state
the bytes, flip the pins — not twenty-two patches.

Vocabulary is the contract's (occurrence, claim, shows, quiescent, hold).
"Response" below means one HTTP response for one address, identified on the
client by the version the handler's `bump` stamped at its header; the document
is a response too — version 0, the t = 0 frame (DR-4).

## Principle — SCs are no different than other rendered data (maintainer, 2026-10-05)

**A server component's output — its frame markup, its records, its traces —
is rendered data like any other async data in Solid 2, and follows the rules
Solid 2 already has for async data; the frames layer adds a transport, never
a second model.** The maintainer's three statements, verbatim: *"SCs are no
different than other rendered data."* *"Hydration ending should follow our
Solid 2 non-SC."* *"SCs participate in `<Loading>` until their first flush
the same way [as any async data], and can have their own internal loading
states that the client doesn't care about."* Every ruling below is therefore
one of two things — the frames **form of a rule the core already has**
(`Restates:` names it: the L2 rulings 1–9 and A-rules of
`packages/signals/docs/SPEC-ASYNC-SEMANTICS.md`; the `<Loading>` rules of
`documentation/solid-2.0/05-async-data.md`; the hydration rules of
`packages/solid/src/client/hydration.ts`), or a **property of the transport**
(`Frames-specific:` names why — a wire delimiter is one; a second notion of
"done" is not). A ruling that is neither is wrong as drafted, and this
document says so where it found one (3.3's client error arm; the contract's
C12 (c) expectation). The design doc carries this as **A0 — Equivalence**
([`server-components-principles.md`](server-components-principles.md) §2,
above A1, same date), with A1–A7/L1 each annotated with the Solid 2 rule it
is the SC form of, and §4's note on which of the contract's reds A0 would have
made unrepresentable.

Four corollaries, one per seam and one for the boundary the seams meet at:

1. **Response identity IS async supersession.** An address is a source; a
   response is a flight answering one question on it; a refetch or a switch
   is a **new question** on the same source. L2 ruling 5 (provenance): *"a
   landing asking an older question than the guess it lands beneath is not
   its answer … nothing moves on screen."* A18 (supersession, 2026-09-10):
   *"a slow source shouldn't leak back in like that"* — only the question's
   own answer, a later question's, or mainline supersedes; a store's
   *"projection landing still consumes the whole layer (fresh authority
   supersedes every tentative write)."* So: a late chunk of a superseded
   response is dropped, never merged; the store holds the **latest answer**,
   not a merge of answers; an answer resolves its parts (`{$ref}`) through
   its own question's context, never the current one's. Seam 1.
2. **Applied state per version IS "a landing replaces the value wholesale".**
   L2 ruling 1 (one frame concept — a node is committed or staged, a flush
   lands or parks), A15 (*"lanes settle as one reveal"*; a stale reader is
   re-derived at the landing), A30 (a frame is replaced by its landing, not
   by the pass that asked). A landing is applied as a whole and every reader
   of it re-derives; nothing of the previous frame is consulted. So: a
   version bump re-applies even a byte-identical root (an equal landing is
   still a landing — A18 (a): *"a landing that equals … confirms"*, the frame
   is the new question's); a **reveal is a landing** (content becoming shown
   is the moment readers of it re-derive — A15's reveal corollary); "applied"
   is a cache of the store keyed by the landing. Seam 2.
3. **Hydration-done IS non-SC hydration-done — ruled.** *"Hydration ending
   should follow our Solid 2 non-SC."* Done is what
   `hydration.ts:checkHydrationComplete` says: the root pass over and
   `_pendingBoundaries === 0`; every hold the frames client takes registers
   **as a pending boundary**, the way a `<Loading>` resume does
   (`initBoundaryResume`), and there is no parallel accounting, no second
   "done", no SC consumer API. `onHydrationEnd` and `isHydrationInProgress()`
   mean the same thing with or without SC. Seam 3 (3.1, with 3.2 as its
   mechanism).
4. **A frame is one async value outward; its inner boundaries are the
   server's.** *"SCs participate in `<Loading>` until their first flush the
   same way, and can have their own internal loading states that the client
   doesn't care about."* **Outward:** to its surroundings a frame is one
   async source. The enclosing `<Loading>` — and hydration-done, per 3 —
   waits for the frame's **first flush** exactly as it waits for any async
   source's first landing (`05-async-data.md` "`Loading` is the UI boundary":
   *"branch readiness … after that branch has produced content, subsequent
   revalidation should not kick you back into the fallback"*; A29's boundary
   exemption, #3540: an unrevealed boundary shows its fallback now, a
   revealed one holds; A33: *"a `<Loading>` boundary showing its fallback is
   the display of everything under it"*), and for **nothing inside it**. A
   refetch or switch is a new question on that source — the boundary's
   retain/`on` behaviour applies as for any memo. *This is what the shell
   gate is* (1.5, 1.6): the boundary's pending state for the frame's first
   flush under the bound address. **Inward:** a server component's own
   `<Loading>`/`<Errored>` are the server's. Their fallbacks, reveals and
   error outcomes arrive **as markup and segments** (`seg:`/`reveal`/the
   fragment templates); the client renders them and tracks nothing: an inner
   segment is not a client pending boundary, does not count toward done, and
   is not the client's to re-judge — a rejected server `<Loading>` shows
   whatever the server rendered for that outcome (3.3; C12 (c)); if the
   server rendered nothing for it, that is a server-half gap to report, not
   a client state to invent. **The inward face exempts nothing of the
   client's:** a fill waiting for its chunk (S1's `prepareArgs`), a record
   defer, a `{$ref}` wait are client-side waits *inside* a frame that has
   had its first flush — the client's own fills — and register under 3 as
   pending boundaries (3.2).

The principle decides five readings the draft left to the maintainer — 1.3
(yes), 1.4 (full), 1.6 (per-address), 2.3 (yes), 3.3 (yes, re-shaped by
corollary 4) — each marked *recommended-by-principle* below; it supports 3.6
(iii) through the hydration adoption rule and asks only that 3.5's sentence
be confirmed. It argues **against** two things as drafted: 3.3's client
error arm (a client `<Errored>` for a server boundary's failure) and the
contract's C12 (c) expectation of a "fresh client error fallback at the
position". Code sites corollary 4 says to change are listed under 3.3.

## The seams, the reds, the duplicates

| seam | question | reds (pins that fail on `next`) | duplicates (audit §4) |
| --- | --- | --- | --- |
| **1. Response identity** | which response owns a record, a `{$ref}` wait, a data table, the shell gate | **C5** (a, b, e) a superseded response's late `data` lands in the current table — R4; **C6** (a1, b2) a held `slot:*` record outlives its response and resolves through the next one's data — R5; **C17** (a, c) the shell gate answers to the frame's registered address, which lags the binding — R8 | two table spaces (`tables` + `stageTables`' `staged`, 183 B); two ref-resolution paths (`host.resolve(ref, frameId)` + the `resolve` parameter threaded through `preview` → `#refsUnresolved`/`#refArgsUnchanged`/`#resolveArgs`/`#resolveRef`); two dedupes (`argsEquivalent` 217 B at apply, `#refArgsUnchanged` 534 B at sync — the first exists because refs are response-scoped and the store is not); two shell gates (`boundaryComponent` + the adopted face in `adoptBoundary`, ≈ 150 B duplicated); `preview`'s data half (the `resolve` it threads). _No red, same question:_ the `_$SC` bootstrap twice — the document's t = 0 address record reaches the mount by `documentAddress` scanning `_$SC.a` (audit S9) |
| **2. Applied state per version** | what a version bump resets; when a reveal is an apply | **C7** (c) a byte-identical v2 root never re-applies, so v2's segment waits for a placeholder v1 removed — R2; **C2** (a2, b; and the harness's C2 replay — R3 rediscovered: record before adoption, fragment revealed after) and **C4** (d) a fragment reveal into adopted content is not a sync trigger — R3 | two version spaces (`FrameImpl.#version` beside `store.version`; `rebase`, ≈ 60–100 B); applied state in seven fields reset at three sites (`#resetStreamState` ×5, `rebind` ×2, the root apply ×1), one of them (`#appliedRootValue`) reset at only one; two reveal engines (`web.js`'s `$df`/`$dfl` and the frame's `#revealSegment`/`#showFallback`, ≈ 1.3 KB on one side — DR-4); the #2978 cascade (`claimRegionFragments` + the `fr.subscribe` body ≈ 250 B) as the document face's half of a sync |
| **3. Hydration-done accounting** | what `done` counts; when a hold lifts; what a claim owes and reads | **C3** (a; and the harness's C3 replay — R1 rediscovered) hydration reports done while an adopted occurrence is still deferred — R1; **C18** (×3: two records drained after the parser finished, a live op before the drain, the live pump's catch-up read) a recordless occurrence is classified while the document still holds its record undrained, its render prop evaluated argless → `TypeError` → `REACTIVITY_HALTED` — R9, **page-halting**; **C19** (×2: patch before claim, two orders) a trace patch delivered before the fill's claim is never shown; heals only on the next distinct patch — R10 (green on S1); **C12** (c) a rejected server `<Loading>` the adoption claimed swaps to a blank, unsurfaced — R6; S1's **C3b** shape (the `prepareArgs` wait — held by S1's own pin as the *expected* order); S1's `.fails` (a keyed sibling after a document boundary misses its key) | the #2968 deferral (`recordsPending` + `#recordRefresh` arm + the drain hook ≈ 300 B) — whose bound is the parser's state while the records it waits for sit in a ledger (`_$HY.r`) nothing consults; S1's `#argsRefresh` + `#heldRecords`, and the `{$ref}` wait's non-carrier: three hold kinds, two carriers, no shared accounting; `drainRecords` + `appliedRecords` (DR-4 row 20) — one `host.apply` per record, a sync per apply; the trace's claim reading (`materializeContainerTrace`'s synchronous replay) and the claim pass's non-mutation (`insertExpression`) each right alone, wrong together. _No red, same question:_ two late-boundary waiters (`boundaryWaiters` + `arrivals`, ≈ 150 B duplicated, resolved from one subscription — a hold already counted through the covering `<Loading>`'s `_fr`; audit S9) |
| outside | — | **C13** (a, b) one sweep, two frames — R7, **confirmed** by `c13-sweep-atomic` on both faces (`a0\|b0 → a1\|b0 → a1\|b1`, identical through `frame:applied` and a `MutationObserver`); the delimiter's shape is in "The server half / wire" below | the asset-loader mirror (audit S10), the three region-rename sites (audit S7) |

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
- **Restates:** corollary 1 — L2 ruling 5 (a flight carries the question it
  answers) and A18's provenance ("a new value from the source answers the
  override's own question or a newer one"): a response is one flight, and
  what it carried is that flight's. Not frames-specific.
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
- **Restates:** corollary 1 — A18 (2026-09-10): a superseded flight's landing
  "is staged for the commit like any landing … but does not supersede"; here
  it has no commit to be staged for and lands in its own dead cell. The
  per-response cell is the frames form of a flight's own result slot.

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
- **Restates:** corollary 1 — L2 ruling 5: an answer is judged by the question
  it answers; A29/A15: a pass derives from the world it was served. A record
  is an answer whose parts (`{$ref}`) are resolved in its own question's
  context; resolving them through the frame's *current* address is the
  "slow source leaking back in" A18 forbids. **Recommended-by-principle: yes.**
  Not frames-specific.

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
- **Restates:** corollary 1 — a memo's value is its latest landing, never a
  merge of landings (L2 ruling 1; A18's store corollary: "a derived store's
  projection landing still consumes the whole layer (fresh authority
  supersedes every tentative write)"). The narrow form keeps a merge of two
  responses in one store, which has no analogue in a node's value.
  **Recommended-by-principle: the full form.** What stays frames-specific is
  the *precondition* — that every response carries its full record set (the
  sink's A5 rule; "may `slot` trail `html`" below) — a property of the wire
  the principle cannot supply; confirm it before taking the full form.
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
- **Restates:** corollary 4 (outward) — the shell gate **is** the enclosing
  `<Loading>`'s pending state for the frame's first flush under the bound
  address, nothing more: "SCs participate in `<Loading>` until their first
  flush the same way". A switch is a new question on the source (A18
  provenance), so the superseded address's apply is an older question's
  landing and releases nothing (L2 ruling 5: "nothing moves on screen"). The
  frames-specific residue is only *where the binding lives* (the `rebind` at
  the commit, ruled 2026-10-04) — a transport fact, not a second gate.

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
- **Restates:** corollary 4 (outward) — the boundary's own rules decide, not a
  frames rule: A29's boundary exemption (#3540: "a loading boundary that has
  not revealed yet … shows its fallback NOW and reveals the staged result at
  the commit; a boundary already showing content … holds like any reader")
  and the `<Loading>` retain rule ("after that branch has produced content,
  subsequent revalidation should not kick you back into the fallback"). (i)
  is those two rules applied to the frame-as-one-value: unrevealed → fallback
  until B's first flush; revealed A → A until B's first flush; A's late
  landing is an older question's (ruling 5) and never reveals. (ii)
  holds-latest is a display rule for a *value already shown* — A was never
  shown, so (ii) misapplies it. **Recommended-by-principle: (i).** Not
  frames-specific.
- **Decides.** **C17 (c)** under (i).

### Fix shape — seam 1

| step | collapse (−) | carrier (+) | net (min B, est.) | pins that flip | touches |
| --- | --- | --- | --- | --- | --- |
| 1a — 1.2, data owned by response | `stageTables` 183; `beginStream` 32; `tableFor`/`ensureTable`'s lazy-create ≈ 84; `stage`'s `data ? … : streams` fallbacks ≈ 60 | per-response cell at `bump` + the unstaged per-response target (the staged entry's shape, smaller) ≈ 140 | **≈ −220** | C5 (a), (b), (e) | `ServerComponentHandlerOptions.onStream` (public: the rotation it signalled is now the cell's install — delete or redefine); `STAGED_DATA` (@internal) generalizes to every response |
| 1b — 1.3, record carries its resolver | `host.resolve` 53 + `FrameHostOptions.resolve` wiring ≈ 40; the `resolve` parameter across `preview` ×2, `#refsUnresolved`, `#refArgsUnchanged`, `#resolveArgs`, `#resolveRef` ≈ 70 | the stamp at chunk→records ≈ 40 | **≈ −120** | C6 (a1), (b2) | `FrameHost.resolve(ref, frameId)` / `FrameHostOptions.resolve` (public, experimental — no caller); `FrameHost.preview`/`Frame.preview` signatures (@internal) |
| 1c — 1.4 full, the store is one response's | `argsEquivalent` 217; the `slot:` arm of `FrameImpl.apply` ≈ 80; `clearStreamRecords`' filter + `root` ≈ 60 | — | **≈ −350** (narrow form: ≈ +50) | none directly; closes the C6 class | the sink's A5 rule must be confirmed (no wire change if it holds) |
| 1d — 1.5 + 1.6 (i), the gate | the second gate (`adoptBoundary`'s face) ≈ 150 | `shellGate()` helper's waiter check ≈ 20; per-address gate memo ≈ 80 | **≈ −50** (1.5 alone: ≈ −130) | C17 (a); C17 (c) under (i) | none public |
| **seam 1** | | | **≈ −740** (≈ −215 br) | 7 of the 22 | |

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
- **Restates:** corollary 2 — L2 ruling 1 (one frame concept: a node is
  committed or staged; a landing replaces the frame) and A30 (a frame is
  replaced by its landing). The store is the node's value; the applied
  record is the frame the last landing produced; a new version is a new
  landing. The second version space (`#version` beside `store.version`) is
  frames-specific only as transport bookkeeping (the host's stale-write
  guard) and should collapse into it.

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
- **Restates:** corollary 2 — A18 (a): "a landing that equals the override
  confirms" — an equal landing is still a landing and completes its frame;
  A15: every stale reader re-derives at the landing. A byte-identical root
  under a new version is the new question's answer and its placeholders are
  the new frame's. Not frames-specific; the value-skip is a cache that
  outlived its frame.

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
- **Restates:** corollary 2 — A15's reveal corollary ("a reveal that discovers
  an async already in flight … is that shared-reader observation") and A29's
  creation-time form: content that becomes shown derives from the world it
  is shown into, so its readers (the fills) run then. A reveal is a landing
  on the document face as `#revealSegment` already treats it on the stream
  face. **Recommended-by-principle: yes.** The document face's reveal engine
  (`$df`) not knowing the frame is a transport fact (DR-4), not a reason the
  rule differs.

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
- **Restates:** corollary 2 — A28 ("a write becomes visible at flush — to
  every channel"): a write to the store is not an application until the
  flush that shows it; `appliedRecords` records the write, `#flush`'s reveal
  is the application. Not frames-specific.

### Fix shape — seam 2

| step | collapse (−) | carrier (+) | net (min B, est.) | pins that flip | touches |
| --- | --- | --- | --- | --- | --- |
| 2a — 2.1 + 2.2, one applied record | `#resetStreamState` 115 → ≈ 45; `rebind`'s two resets ≈ 40; seven field declarations → one ≈ 30; `rebase` 24 → ≈ 15 | the record constructor ≈ 60; longer member paths in `#flush` ≈ 50 | **≈ −70** (≈ −130 if `#version` folds into the host's guard — pending the `rebase` question) | C7 (c) | none public |
| 2b — 2.3 interim, the document reveal syncs | — | the `fr.subscribe` → scoped-sync call ≈ 40; exposing the sync ≈ 30 | **≈ +70** | C2 (a2), C2 (b), C4 (d), the harness's C2 replay (R3) | a `Frame` method or an internal options hook (flag if public) |
| 2c — 2.3 structural, DR-4 | one reveal engine ≈ 1.3 KB on one side; the #2978 cascade ≈ 250 | the document ledger as frame-`""` store writes (unestimated) | its own plan | the same four, by construction | the document runtime (`$df` family); artifacts re-recorded |
| **seam 2 (2a + 2b)** | | | **≈ 0** (≈ −70 + 70) | 5 of the 22 | |

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
red (C3 a). Both cannot stand. One of the four — the record defer — also
*lifts* on the wrong condition: it asks the parser whether records may still
come, while the records it is waiting for already sit in a ledger (`_$HY.r`)
nothing consults; that is C18 (3.5), the only page-halting red the contract
holds. And a claim that lands after a hold reads state the markup was not
rendered from, and shows the markup anyway — C19 (3.6).

### 3.1 Hydration-done follows non-SC Solid 2 — **ruled 2026-10-05**

**SC follows non-SC: done is what plain hydration says it is; frames
register their holds with it.** Maintainer, verbatim: *"hydration ending
should follow our Solid 2 non-SC."* Server components get no notion of done
of their own. Hydration is done when plain Solid 2 hydration says so — the
root pass completes and every registered pending boundary has resolved
(`_pendingBoundaries` / `checkHydrationComplete`) — and the frames client
participates **through that mechanism**: every hold it takes (the #2968
record defer, the `{$ref}` wait, S1's `prepareArgs` hold, any late-boundary
wait) registers as a pending boundary the way a `<Loading>` resume does, and
introduces no parallel accounting, no second "done" signal, no SC-specific
consumer API.

- **Mechanism today.** `solid/src/client/hydration.ts:checkHydrationComplete`
  (`!_hydratingValue && _pendingBoundaries === 0`), `drainHydrationCallbacks`
  (`_hydrationDone`, the `flush()`, the callbacks, then on a timeout
  `verifyHydration`, `_$HY.done = true`, `registry.clear()`),
  `isHydrationInProgress` (`!_hydrationDone && (hydrating || _pendingBoundaries > 0)`);
  `initBoundaryResume(o, id)` is the one registration (`_pendingBoundaries++`,
  `o._hp = 1`, `captureBoundaryScope`, a once-only `release` run by resume,
  the asset path or disposal). `FrameImpl.#syncSlots`' deferrals touch none
  of it (R1).
- **Reading chosen: (i) — done counts the page**, in the maintainer's terms:
  not because the page needs a new concept of done, but because the frames
  client must not have one of its own. The non-SC runtime already defines
  done as "root pass over, no pending boundary"; a frame's hold is a pending
  boundary in everything but registration, so registering it is consistency
  with the runtime, and `onHydrationEnd` / `isHydrationInProgress()` then
  mean the same thing with or without SC. Reading (ii) — "done is the root
  pass's and its boundaries'; a frame's hold is the frame's business" — made
  done a statement about one of two claimants and gave the frames client a
  private notion of finished; it is what the ruling rejects. Cost under (i):
  every hold must be bounded (L1) or done never comes; the frames' holds are
  — the record defer by the drain's end (3.5: the document complete, no
  fragment left, *and* nothing delivered left undrained — not by
  `recordsPending` alone, which is the parser's state and is what C18 breaks
  on), the ref wait by the stream's `complete`/`:error`, the `prepareArgs`
  wait by the chunk load's settle or rejection, the late-boundary wait by
  exhaustion — exactly the bound a `<Loading>` resume has.
- **Consequences.** `onHydrationEnd` and `isHydrationInProgress()` mean the
  same thing with or without SC. S1's pin
  `container-trace-hold-hydration-end.spec.tsx` ("hydration completes while
  the load pends; the late mount claims the server markup") asserts
  done-before-claim and is a **re-pin** under this ruling: "hydration waits
  for the load; the mount claims before done" — the same assertions on the
  claim, the opposite assertion on the order. The contract's C3 pins — (a)
  the record defer, and S1's (b) `prepareArgs` — become the expected
  behaviour and flip with 3a.
- **Cost, accepted.** As landed (3.2 via `sharedConfig.holdBoundary`,
  #3831) the hold is ≈ +59 B min on every hydrating page and ≈ +290 B min
  on the frames client — over the size gate's 20 B minified allowance on
  the hydrating scenarios and over the frames-eager and page caps. The
  maintainer accepted it, 2026-10-06: *"pay the cost for correctness."*
  The caps are raised to CI-measured + 10 B in the landing PR under a
  `Size-Exception:`; the ratchet lowers them again as the 1b deletion
  (`preview` / `stage`'s client half) pays the bytes back.
- **Restates:** corollary 3 — `hydration.ts`'s own rule: done is
  `!hydrating && _pendingBoundaries === 0`, and a pending boundary is
  anything registered through `initBoundaryResume`. Not frames-specific; the
  draft's `sharedConfig.holdHydration` seam *was* frames-specific, and the
  ruling removes it (3.2).
- **Decides.** **C3 (a)** the #2968 record defer, and the harness's C3
  replay; S1's **C3 (b)** shape (the `prepareArgs` probe — holds on `next`
  because `next` has no `prepareArgs`; on S1 it is this ruling's second
  arm).

### 3.2 — mechanism of 3.1: every hold the frames client takes is a pending boundary, registered once per frame

**The record defer, the `{$ref}` wait, the `prepareArgs` wait and any hold
added later are one pending-boundary registration on the hydration runtime
while the frame has an adopt-time occurrence deferred, released when a sync
leaves none or the frame disposes. The carrier is `_pendingBoundaries`
through the existing registration, not a new seam.**

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
- **Carrier (revised under the ruling).** `#syncSlots` already computes, per
  adopt-time occurrence, whether it deferred (every `continue` before the
  mount); the frame holds **one pending-boundary registration** while that
  set is non-empty: at the end of the sync, `deferred && !this.#hold`
  registers (`this.#hold = options.hold()`), `!deferred && this.#hold`
  releases; `dispose` releases. What `options.hold` *is* changes: not a new
  `sharedConfig.holdHydration` counter, but the registration a `<Loading>`
  resume takes — `adoptBoundary` registers the adopted frame's owner through
  the existing `initBoundaryResume(owner, frameId)` path (its `release` is
  the hold's release: `_pendingBoundaries--`, `checkHydrationComplete`;
  `captureBoundaryScope(frameId)` is harmless for a frame — `claimRender`
  uses its own range-scoped registry — and the registration's `onCleanup`
  gives disposal for free). The only `hydration.ts` change is making that
  registration reachable from the adopter (`sharedConfig.resumeBoundary` or
  an `internal` export — one assignment in `enableHydration`), no new
  counter, no new "done" path. S1's `#heldRecords` is the natural set to
  register for (it is exactly the adopt-time held occurrences with a
  record); the recordless defer joins it. Under 3.5 the deferred set also
  holds an occurrence whose record is delivered and undrained — without 3.5
  the registration is wrong in the other direction: a sync that classifies
  such an occurrence leaves nothing deferred, and the hold releases a drain
  early.
- **Inward face, stated so nobody reads it as an exemption (corollary 4).**
  These holds are the **client's own** — a client fill waiting for its
  chunk (`prepareArgs`), for its record, for its `{$ref}` data — inside a
  frame that has already had its first flush. They are not the server's
  internal loading states (those arrive as `seg:`/`reveal` and register
  nothing); they are client pending work and register under 3.1 exactly as a
  client `<Loading>` would.
- **Restates:** corollary 3 — `initBoundaryResume` is the non-SC rule's one
  registration; this ruling is the frames client calling it. Not
  frames-specific.
- **Ordering to pin with it.** S1 parks a trace's backlog beyond the snapshot
  until `onHydrationEnd` so the claim sees the markup it was rendered from
  (3.6 (iii)). Under (i) the park's release moves later, never earlier: the
  claim is synchronous at the materialization (`prepareArgs` settles → sync →
  invoke → revive → materialize → claim), the frame's hold releases after that
  sync, done after the hold, the backlog after done. No deadlock; pin the
  order.

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
- **Decides.** **C12 (c)** — re-read under corollary 4 (inward): the server
  `<Loading>` inside the frame is the *server's* boundary; its rejected
  outcome shows **whatever the server rendered for that outcome** (its
  `<Errored>` fallback, or the boundary's own markup), and the client's job
  is to show it — never to blank, never to invent a client error state for
  it. The "fresh error fallback at the position" the contract expected is
  therefore **not** what the principle says: a client boundary rendering a
  fresh fallback for a server boundary's failure is the client re-judging a
  server state. The stream face already does the right thing
  (`frame-sink.ts:588`: "a fragment that ERRORED still reveals (its html is
  the fallback / error template), but the failure is surfaced as a keyed
  error chunk" — the `seg:<k>:error` record is a *diagnostic*, consumed by
  nothing that renders). The document face does not: the server's error
  path writes a **blank** template (`web/src/server.ts:2911`,
  `sink.fragment(key, value ?? " ")`) and rejects `_fr` — the blank is the
  **server-half gap**, and R6 is its symptom. **Recommended-by-principle:
  yes, re-shaped** — the client shows the server's outcome; the fix is the
  server's.
- **Carrier (revised).** *Server half (the fix):* the document face's error
  path renders the boundary's error outcome into the fragment template as
  the stream face's `meta.error` path does — the nearest server `<Errored>`'s
  fallback; with none, the error escapes the server component (A5's server
  twin) and the whole response is the frame's `:error`, which is the
  **outward** face: the frame as one async value errored, surfaced to the
  enclosing client `<Errored>` through the gate's error apply as today. The
  `_fr` rejection stays as the diagnostic it is. *Client minimum (3b):* a
  dev-only report when a claimed fragment's `_fr` rejects (≈ +30 B dev, 0
  prod) — no `seg:<k>:error` write for the document face, no declined swap,
  no throw to a client `<Errored>`. **Not the shape (and the draft had it):**
  the claimant throwing through the reveal seam's boundary to the nearest
  client `<Errored>` — that invents a client error state for a server
  boundary; the principle argues against it.
- **Code sites corollary 4 says to change or re-read** — places where an
  inner server boundary is treated as client state:
  - `client.ts:adoptBoundary.claimRegionFragments` → `fr.claim(fragId)` →
    `hydration.ts:claimFragment` (#2978): the adoption goes on record in the
    fragment ledger as the *claimant* of every `pl-*` in its region so the
    post-done held-swap policy (`fragmentPolicy`, #2964) lets the swap land.
    That is client claimant state for a server boundary. The principle's
    shape: the ledger knows a fragment inside an adopted frame's range is
    the **frame's content** (the frame is the claimant of everything in its
    range by adoption, not fragment by fragment) — S9/DR-4's "the fragment
    ledger not knowing adopted regions own their placeholders" is this same
    finding from the size side. Change, under DR-4; the cascade is a
    compensation until then. (Not `claimedBoundaries` — that set is one
    adopter per *frame element*, the outward face, and is right.)
  - `client.ts:revealSeam` — the stream face wraps each revealed segment's
    content in a reconstructed client `createLoadingBoundary`. Its stated
    job is to cover the **fills'** own async ("an unboundaried async fill's
    `NotReadyError` propagates up … to it") — the client's own work, which
    corollary 4 allows — not to be the server `<Loading>`'s client twin. It
    is created from stream microtasks, so it never takes the hydrating path
    and registers no pending boundary: consistent. Re-read, not change: it
    is the fills' boundary; it must never be made the segment's error
    boundary (above).
  - `client.ts:adoptBoundary.recordsPending`'s `fr.pending()` term: reads the
    document-wide fragment ledger's pending state as "the document may still
    deliver a record script" — a fact about record *delivery*, not a
    re-judgement of any boundary. Consistent; under 3.5 the term stays
    beside the delivered-undrained one.
  - `hydration.ts:hydratedCreateLoadingBoundary`'s `s === 2` arm (resume
    fresh, error to the nearest `<Errored>`) runs only for a boundary with
    a client twin registered against `_fr`. A server-only `<Loading>` has
    none — **correct** under corollary 4, and the reason no client fallback
    exists to render; the contract's R6 read the absence as the bug.
  - The frame's `:error` → gate release → enclosing `<Errored>` (outward):
    consistent; this is the only client error state a frame has.

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
- **Restates:** the hydration-id rule every component obeys (ids are the
  owner chain's; `transparent`/`runWithOwner(null)` is the one way to consume
  none — `05-async-data.md` "SSR and hydration"). **Frames-specific** only in
  *which* owner the server minted — a transport fact to pin, not a rule.

### 3.5 An occurrence is classified only after every delivered record has drained

**A recordless adopted occurrence is direct-insert content only once nothing
the document delivered for its boundary is still waiting to be applied: the
record defer's bound is the drain's end, not the parser's — a sync that runs
while `_$HY.r` holds an unapplied record for the boundary defers every
recordless occurrence it finds, whatever triggered the sync.**

- **Mechanism today.** `FrameImpl.#syncSlots`' #2968 arm: `record === undefined
  && !root && adopt && recordsPending()` → arm `#recordRefresh` (a `setTimeout`
  that runs `drainRecords()` then `#syncSlots()`), `continue`; otherwise
  classify — a recordless called occurrence (`prop#n`) is invoked argless
  (dev names it; prod proceeds). `adoptBoundary.recordsPending` answers
  `readyState === "loading" || fr.pending()` — the parser's state (§3 45:
  "while the document can still run data scripts"). `drainRecords` applies
  one record per `host.apply`, each a synchronous `#flush` → `#syncSlots`.
  Three ledgers, two consulted: the document's (`_$HY.r`, where the data
  script put the record), the store's (where the drain puts it), the page's
  (2.4). "Recordless" reads the store, "pending" reads the parser, and nothing
  reads the gap between them — a record delivered and not yet drained.
- **The red (R9).** Two records owed at adoption; both execute; the parser
  finishes before the deferred timer fires (the document's tail — the frame's
  data scripts and the end of the response — parses in one go, so this is the
  common order, not a contrived one). The timer's `drainRecords` applies
  record #0 → `#flush` → `#syncSlots`: #0 mounts; #1 is recordless in the
  store, its record sits in `_$HY.r` one loop iteration away,
  `recordsPending()` is false → classified direct-insert → the render prop is
  evaluated as a zero-arg accessor → `props.text` → `TypeError` inside the
  insert effect → `REACTIVITY_HALTED`. The same window is reached by a live
  hole op (`applyLiveOp` → `host.apply`) and by the live pump's catch-up read
  (`pumpLiveChannel`'s first async read replaying ops logged before adoption)
  — any sync, not only the drain's. C18 ×3.
- **Plain bug or new sentence?** New sentence. §3 45's bound is the parser's
  and the code honours it exactly; no existing sentence says a delivered
  record counts as pending until applied — 2.4 names the store ≠ page gap
  (`appliedRecords` is a delivery dedupe), not the document ≠ store gap, and
  3.1 (i) in this document's own draft named `recordsPending` as the record
  defer's bound. The sentence has one reading — nobody rules for the
  `TypeError` — so the maintainer confirms rather than chooses; it exists so
  the carrier cannot miss again (2.2's reason). It also makes 3.2 right: a
  hold that releases on the parser's end releases early, and 3.2's count
  would release with it.
- **Decides.** **C18** (×3: the drain's own first apply, a live op before the
  drain, the pump's catch-up read). The harness's control (a tick between the
  two records) holds today and keeps holding.
- **Carrier.** The predicate: `adoptBoundary.recordsPending` gains a third
  term — `_$HY.r` holds a key under the boundary's `sc:slot:<id>:` or
  `sc:region:<id>.` prefix not yet in `appliedRecords` — so "pending" means
  delivered-and-undrained as well as not-yet-delivered. The defer arm needs
  no change: on the drain's own first apply the other record's key is not yet
  in `appliedRecords`, so the sync defers it and the loop's next apply mounts
  it; a redundant timer fires once into a no-op. ≈ +50 B min (≈ +15 br). The
  drain, batched: `drainRecords` collects every delivered record and hands
  the host one write — `FrameImpl.apply(write)` already takes a multi-record
  `FrameWrite.r` and flushes once; what is missing is a chunk that carries
  several records (`chunkToRecords` merging an `ops` member, ≈ +40 B — the
  same member C13's delimiter needs, below) — so a drain is one sync, never a
  sync per record. Optional for the invariant (the predicate alone carries
  it), but it is the shape 2.4 reads the drain as ("delivery to the store"),
  it makes a drain O(occurrences) instead of O(records × occurrences), and it
  is the client arm C13 wants regardless. Not the shape: calling
  `drainRecords` from inside `#syncSlots` — a drain is `host.apply` → `#flush`
  → `#syncSlots`, re-entrant into the sync that called it. Under S9/DR-4
  (A5-complete records: the sink writes frame-shaped records into the one
  buffer before adoption can observe them) the drain, the defer and this
  predicate all delete; the sentence is then true by construction and is what
  S9 must satisfy.
- **Restates:** the hydration adoption rule — a hydrating node reads its
  serialized answer before it computes (`ssrSource: "server"`/`"hybrid"`:
  "the client seeds from the serialized server value"; the compute "is
  deferred until … the adopted answer has landed") — and A5 as the
  consequence of breaking it (an error escaping every boundary halts the
  system: the `TypeError` → `REACTIVITY_HALTED`). Classification is a compute
  over the serialized answer; `_$HY.r` is that answer; deciding before it is
  read is computing before adoption. **Frames-specific** only in *where* the
  answer sits (`_$HY.r` versus the store — the drain is the transport's two
  steps); the sentence itself is the adoption rule.

### 3.6 A claim shows the value it read — and reads what the markup was rendered from

**A fill that claims adopted markup reads the state the server rendered it
from — a container trace's snapshot, the record the occurrence was held on —
and claims against it; what moved before the claim (a patch beyond the
snapshot, a record that replaced the held one) lands after the claim as the
update it is. The claim pass never rewrites a hole.**

- **Mechanism today.** `web/src/client.ts:insertExpression` under hydration is
  a claim pass, not a mutation pass (C1/C9: nothing moves);
  `materializeContainerTrace` replays the trace's buffered emissions
  synchronously at revive, so a fill's first read is the snapshot *with every
  patch so far*; `claimRender` claims the text node as-is. R10: the server
  rendered `2`, a patch to `5` lands before the claim (record → patch →
  hydrate, patch → record → hydrate, or hydrate → patch → record through the
  deferred claim); the fill reads `5`, the DOM keeps `2`, nothing warns; the
  next *distinct* patch heals it, a same-value patch never does. The trace
  model assumed the server's text IS the store's first value — true only if
  no patch precedes the claim.
- **Lives twice in.** The claim's two inputs are answered by two mechanisms
  that are each right alone: the materializer's synchronous replay (C11: a
  trace equals its oracle at every point) and the claim pass's non-mutation
  (C1/C9). On S1 (`9927ddddd`, third commit) one shape answers both:
  `materializeContainerTrace(marker, claiming)` parks the replayed backlog
  beyond the snapshot (`limit = 1`) until `afterHydration` (`onHydrationEnd`,
  or a microtask once the pass is over) and then releases it (`limit =
  Infinity; bump()`); `claiming` is threaded `FrameHostOptions.revive(value,
  claiming)` → `reviveContainerTraces` → `materialize` from the adopt-time
  mount's `#resolveArgs`; and `#heldRecords` claims an occurrence with the
  record it was *held* on and applies the record that replaced it as an args
  change. On `next` neither exists.
- **Three shapes; the maintainer picks.** The contract names the first two.
  - **(i) The claim pass reconciles.** A hydrating `insertExpression`
    rewrites a text hole whose value already differs (narrow: text holes,
    trace-sourced values). Touches `web`'s claim pass — the rule C1/C9 rest on
    ("nothing moves") gains an exception; covers text only (a trace that grew
    a list between SSR and claim still key-misses); ≈ +40 B in `web` on every
    hydrating page.
  - **(ii) The producer holds.** No patch crosses before the record's claim.
    But the claim's moment is the client's (a deferred claim runs after the
    parser), and the document face has no back-channel to say when — so the
    server can only hold until the response ends: the trace's liveness at
    t = 0 goes, and the stream face would need a chunk to say so. Server half,
    wire change; worse than (iii) on every axis.
  - **(iii) The consumer parks — S1's shape.** The materializer, told it is
    read for a claim, serves the snapshot and parks the rest until hydration
    ends; the backlog then applies as ordinary updates and the DOM catches up
    outside hydration. (ii)'s rule carried on the client with no wire change:
    the claim reads what the markup shows by construction, the claim pass
    stays non-mutating, structural divergence is covered (the claim always
    sees the snapshot's shape), and the park is a bounded hold (L1: by
    `onHydrationEnd`, which 3.1 (ruled) moves later — 3.2's "ordering to pin"
    already says the park releases after the frame's hold). Cost ≈ +90 B min
    est. (the `limit`/`afterHydration` arm ≈ 70, the `claiming` thread ≈ 20)
    — already paid on S1. Consequence to pin: during the park the trace's
    *store* reads the snapshot while its oracle has the patch, so C11's
    "every observable point" is read as "outside a claim's park"; the
    harness's settled points (ticks, the end) fall after the release, and
    C19 ×2 are green on S1 with every other pin unchanged.
- **Recommend (iii).** It is built, pinned (S1's
  `container-trace-hold-{snapshot,hydration-end}` specs) and green on C19 ×2;
  it keeps the claim pass the claim pass. One correction to the contract: its
  R10 describes S1's path as one that "reconciles the text with the live
  value" and its fix order reads S1 as evidence for (i); `9927ddddd`'s own
  comment says the opposite — "a text hole is never rewritten during a claim"
  — and the mechanism is the park. S1 is evidence for (iii), and that (ii)'s
  rule is reachable without the wire. (i) remains the answer only if the
  maintainer wants the patched value *at* the claim rather than one
  hydration-end later; nothing else needs it.
- **Decides.** **C19** (×2) under (iii) — the pins flip when S1 lands or its
  third commit is ported. 3.3's sibling: 3.3 says the claimant owns what the
  swap delivers after the claim; 3.6 says the claimant reads what the markup
  was rendered from and owns what moved before it.
- **Restates:** the `ssrSource: "hybrid"` hydration rule, verbatim the shape:
  "the client seeds from the serialized server value; then, for a compute
  that returns an async iterable, the client continues the stream from it
  … the client re-runs the generator once the adopted answer has landed …
  later yields update the node. That handoff is the tail of the initial
  load, not a refetch." A container trace is such a stream; the snapshot is
  the adopted answer; the parked backlog is the continuation after the
  adopted answer has landed. (iii) is that rule; (i) would make the claim
  pass a mutation pass (against C1/C9 and the rule's "seeds from the
  serialized value"); (ii) has no non-SC analogue. The principle supports
  (iii); it is left to the maintainer only because the contract named (i).

### Fix shape — seam 3

| step | collapse (−) | carrier (+) | net (min B, est.) | pins that flip | touches |
| --- | --- | --- | --- | --- | --- |
| 3a — 3.1 (ruled) + 3.2, the frame's hold is a pending boundary | the three hold kinds become one `deferred` set the sync already walks (S1's `#heldRecords` + the recordless defer); no bytes leave — the wake-ups stay | `hydration.ts`: expose the existing `initBoundaryResume` registration to the adopter (one `sharedConfig` assignment, no new counter) ≈ 25 (the **hydrating** scenario pays ≈ +8 br, was +30 under the draft's new seam); `#hold` register/release at the sync's end + `adoptBoundary` wiring the registration into the frame's options ≈ 100 | **≈ +125** (was ≈ +200 with `holdHydration`) | C3 (a), the harness's C3 replay; S1's C3 (b) on S1 | **re-pin:** `test/hydration/container-trace-hold-hydration-end.spec.tsx` — "hydration completes while the load pends; the late mount claims" → "hydration waits for the load; the mount claims before done" (claim assertions kept, order inverted); `FrameOptions.hold` (option wired by `adoptBoundary`, internal use — flag as surface); `sharedConfig.resumeBoundary` (internal) |
| 3b — 3.3 client minimum (re-shaped) | the draft's `_fr` rejection consumer (≈ 120: declined swap, `seg:<k>:error` write, throw to a client `<Errored>`) is **not taken** — corollary 4 | a dev-only report when a claimed fragment's `_fr` rejects ≈ 30 dev / 0 prod | **0** prod | C12 (c) re-pins to "shows the server's rendered outcome; never a blank; rejection reported in dev" and flips with the **server half** (the document face renders the error outcome into the fragment as the stream face does) | the server's blank-template error path (`server.ts:2911`) is the fix; no client surface |
| 3c — 3.4 id parity | — | client mirror of the server's consumption ≈ 40, or server-side normalization | **≈ +40** or 0 | S1's `.fails` | the server half if normalized there |
| 3d — 3.5 classification waits for the drain | — | `recordsPending`'s delivered-undrained term ≈ 50; the batched drain through a multi-record chunk ≈ 40 (optional; shared with C13's client arm) | **≈ +50** (≈ +90 with the batch) | C18 ×3 | none public for the predicate; the multi-record chunk is a `FrameChunk` member (wire — C13's delimiter; flag) |
| 3e — 3.6 (iii) the claim reads the snapshot, the backlog lands after | — | S1's `claiming` park: `materializeContainerTrace`'s `limit`/`afterHydration` ≈ 70, the thread through `revive` ≈ 20 | **≈ +90** on `next`; **0** if S1 lands first (it is S1's third commit) | C19 ×2 | `FrameHostOptions.revive(value, claiming?)` (@experimental) and `reviveContainerTraces`/`setContainerTraceMaterializer`'s second parameter — S1's surface, already flagged there |
| **seam 3** | | | **≈ +305** (≈ +90 br); ≈ +215 (≈ +60 br) with S1 landed | 8 of the 22 + S1's two (C12 (c) with the server half) | |

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

**Ruled.** **3.1** — hydration-done follows non-SC Solid 2 (2026-10-05).

**Readings the draft left open, re-derived against the principle** — each
"decided by the principle?" yes/no; a *yes* is recommended-by-principle, not
ruled, until the maintainer nods.

1. **1.3** a record resolves through its own response's data — **yes**
   (corollary 1: an answer resolves its parts in its own question's context;
   L2 ruling 5, A18 provenance).
2. **1.4** narrow / full — **yes, full** (corollary 1: the store is the latest
   answer, a merge of responses has no analogue in a node's value; A18's
   store corollary). The *precondition* — the sink's A5 rule, "may `slot`
   trail `html`" — stays open as a wire fact (below).
3. **1.6** per-address gate value (i) / holds-latest (ii) — **yes, (i)**
   (corollary 4 outward: the boundary's own pending state; A29 #3540's
   exemption, the `<Loading>` retain rule, ruling 5).
4. **2.3** a reveal is an apply — **yes** (corollary 2: a reveal is a landing;
   A15's reveal corollary, A29's creation-time form).
5. **3.3** a claimant owns the outcome — **yes, re-shaped** (corollary 4
   inward: the client shows the server's rendered outcome, never a blank,
   never a client-invented error state; the fix is the server half's).
6. **3.5** classification waits for the drain — **no reading to decide**; one
   sentence to confirm (it restates the hydration adoption rule and §3 45's
   bound is re-stated as the drain's). *Open: confirm the wording.*
7. **3.6** (i) reconcile / (ii) producer holds / (iii) consumer parks — **the
   principle supports (iii)** (the `"hybrid"` hydration rule is its shape) and
   argues against (i) (a claim pass that mutates) and (ii) (no non-SC
   analogue). *Open only because the contract named (i): the maintainer
   picks.*

**Genuinely open after the principle:** 3.5's wording (confirm), 3.6's shape
(pick; (iii) recommended), and one wire fact the principle cannot supply —
whether `slot` may trail `html` (1.4's precondition; RFC 11 fixes no order,
the sink emits records ahead of markup, C6 (a1) assumes the reverse is
legal). Everything else above is decided by the principle pending the nod.

**Decided by default in the overnight correctness pass (2026-10-06;
#3830–#3833) — each the reading A0 implies, with the alternative written.**
The pass was run unattended under the instruction "when something needs a
decision, make the conservative choice, write it down, and move on"; these
are those choices. **Accepted by the maintainer, 2026-10-06** (*"I trust
you, nothing super flagged"*): every default below stands as made; the
alternatives stay written as the record of what was weighed.

1. **The gate releases at the new address's first FLUSH, not its `start`
   (1.5; C17 a re-pinned).** The pin as first written had B's `start`
   chunk release the gate — the frameless waiter's incidental behaviour
   (any fan-out released it), and this document's own "B's first chunk
   releases it" repeated it. A0: the boundary waits for "the frame's first
   flush"; a `start` is the response announcing itself, and an empty
   `<solid-frame>` revealed at it is the flash the gate exists to prevent.
   `FrameHost.landing` resolves at the root, the stream's error, or its
   completion. _Alternative:_ resolve the landing on `start` too (one line
   in `createFrameHost.apply`) and restore the pin's first assertion.
2. **A warm switch-back shows the committed value; the flight is not
   surfaced as pending (1.6; C16 d).** `landing(address)` is `undefined`
   once the address has a landing to show, a later response in flight
   notwithstanding — this document's "first flush under the bound address",
   and L2's holds-latest at the source. _Alternative:_ a per-address node
   born committed (`{ loadingValue: element }`) when the host has a
   landing, so the boundary's `isPending` reports the flight (≈ +40 B; the
   host must expose warmth). No pin observes the difference.
3. **The occurrence's name decides its class on every sync (1.4's open
   item; C18 made unrepresentable).** The sink mints every called
   occurrence as `prop#n` with its record and a bare `prop` is direct-insert
   by design, so a called occurrence found recordless WAITS — a fresh mount
   is not invoked, a mounted one keeps its applied args; the delivering
   write re-syncs. Required by 1.4 full (between a new version's `start`
   and its slot records an occurrence whose markers are already in the DOM
   is recordless) and it retires the #2968 defer's classification role (the
   poll stays as the document face's re-sync trigger, scoped to called
   occurrences). _Alternative:_ pin the sink's order and keep argless
   invocation on the stream face — rejected: a crash path (C18's) that 1.4
   makes reachable.
4. **2.3's interim form landed with S-flush (#3830), not as its own step.**
   Scoping the defer to called occurrences removed an accidental poll (bare
   occurrences arming `#recordRefresh` on every adopt sync) that had masked
   R3 in the harness; without a reveal sync the campaign gained seven C2
   cases. The document face's reveal cascade now applies an empty write at
   the frame's version (`frame.apply({ version, r: {} })` — "a reveal is an
   apply", literally; no new surface). _Alternative:_ restore the accidental
   poll and leave 2.3 to its step — rejected as keeping a mechanism nobody
   designed. **C2 (a2)** (the record landing after the reveal with the
   parser done and no fragment pending) stays red: it is S-record's — a
   plain write into `_$HY.r` observed by nothing — not 2.3's.
5. **1.2 by the store's version guard, not per-response data cells (C5).**
   With the response announced to the store at its header, a `data` chunk
   whose restamped version is below the store's lands nowhere — the same
   statement as every other chunk's (#3832, ≈ 30 B). _Alternative:_ the
   cell (`stage`'s entry shape for every response, `onStream` redefined) —
   deferred to the `preview` deletion (1b), which reshapes the handler
   anyway. **1.3** (records carry their resolver) is thereby not built: with
   1.4 full a held record leaves at the bump and no stale data enters the
   current table, so the forbidden resolution has no path.
6. **3.2's registration is `initBoundaryResume`'s, keyed `sc:<fid>`, taken
   only while `isHydrationInProgress()` (#3831).** The registration's
   `release` retires the fragment claim under its `id` and its disposal
   cleanup runs `cleanupFragment(id)` — keyed where fragments are, so the
   holder passes a key no fragment uses. A hold registered on a page that
   never ran `hydrate()` (a `createRoot` render adopting server markup)
   would on release flip the page to done and hold every later swap, so the
   frames client registers only while hydration is in progress.
   _Alternative:_ a counting-only registration in solid without the
   fragment bookkeeping (≈ +150 B min on hydrating pages, the first cut).
   The cost as landed is ≈ +59 B min on every hydrating page — more than
   the ≈ 25 estimated here — and over the size gate's 20 B minified
   allowance. **Accepted by the maintainer, 2026-10-06** (*"pay the cost
   for correctness"*): the hydrating, hydrating + stores, compiled
   hydrating, frames eager and both page caps are raised to CI-measured
   + 10 B under a `Size-Exception:` in the landing PR.
7. **3.3's client half is a dev `console.error`, not a diagnostic code
   (#3833; C12 c re-pinned as c1 green / c2 red).** The frame's existing
   dev reports for server-side outcomes (a hole that failed on the server)
   use `console.error`; a structured code is new surface. The server half
   (the blank template) is drafted below, not coded.
8. **S-adopted (`claimRegionFragments → fr.adopt`) documented, not built**
   (3.3's code-sites list): ≈ +80 B in solid on every hydrating page, on
   top of 6's +59 — the maintainer's call.
9. **The harness's C3 law exempts a done that fired at or after the
   mount's disposal** (a disposed holder owes no claim; its release is what
   lets done fire — `initBoundaryResume`'s own rule). An oracle correction,
   not a contract change; verified to hide nothing on `next`.

**Product questions — carried under the principle; the principle's answer
is given as a recommendation, not a ruling.**

- **What a rejected server-only `<Loading>` inside a server component shows**
  (C12 c, 3.3) — **decided by corollary 4 (inward)**: what the server
  rendered for that outcome — its `<Errored>` fallback, or the boundary's
  own markup; with no server `<Errored>`, the error escapes the server
  component and the frame's `:error` is the outward face (the enclosing
  client `<Errored>` sees one errored async value). Of the draft's three
  options this is the third (a server-rendered error outcome in the
  fragment — the stream face's `meta.error` path already does it, the
  document face writes a blank) plus the first *only* through the frame's
  own `:error`; the second (a client latch at the position) and the
  contract's "fresh client error fallback at the position" are the client
  inventing a state for a server boundary, which the principle rejects. The
  server half's change (the blank at `server.ts:2911`) is what flips the pin.
- **Settles-once projections crossing as a trace rather than a promise-of-
  snapshot** — **the principle prefers promise-of-snapshot**: a settled async
  value *is* a value (A19 exception 1 / A27: after the first landing a node
  is an ordinary memo; a flight that has landed is its value, not a stream
  with no further yield). A producer that has settled once has nothing left
  to stream; crossing it as a live container with a backlog to park
  (S1's shape) makes the client run a store engine for a value. Under
  promise-of-snapshot 3.6 (iii) has nothing to park and holds by
  construction; the park remains right for a producer still live. Wire/DR-2
  change (the tier decision is the sink's) — recommendation.
- **Whether crossing containers are live by default** — **yes, live** when
  the producer is live: a projection is a projection, server or client; a
  live store passed as a prop on the client is read live, and the principle
  gives the server no reason to differ (DR-2 case 3 is the rule applied).
  Combined with the previous item: *live if the producer is live, a value if
  it has settled* — the tier is the producer's state, not a per-site option.
  Decides how much of 3.2's `prepareArgs` hold a typical page takes (only
  pages whose producers are still live at render time). Recommendation.
- **Whether `slot` may trail `html` on the wire** (1.4's open item) — RFC 11
  fixes no order; the sink emits records ahead of markup; the contract's
  C6 (a1) assumes the reverse is legal. Decides whether the #2968 defer
  generalizes to every sync.

**The server half / wire (§6.3) — out of these rulings.**

- **C13** (R7, one sweep one frame) — **confirmed** by `c13-sweep-atomic` (a,
  b): both faces show `a0|b0 → a1|b0 → a1|b1`, through `frame:applied` and a
  `MutationObserver` alike. **Restates:** A28 ("a write becomes visible at
  flush — to every channel"; one flush is one frame) and L2 ruling 1: a
  sweep is the server's one flush, and its landing on the client must be
  one flush too. **Frames-specific** in the only way the principle allows:
  the *wire* carries the server's flush as N ops with no edge, so the
  client cannot know the unit — a real property of the transport, fixed on
  the wire. The client has no unit larger than one op:
  `applyFrames.drain` does one `host.apply` per framed chunk with an `await`
  between; `pumpLiveChannel` reads the `sc:live` `ReadableStream` one op at a
  time and `applyLiveOp` applies each; every op is its own `FrameImpl.apply`
  → `#flush` → `#applied`. The sink *has* the unit: `frame-sink.ts`'s
  `sweep()` walks every binding in one synchronous span (coalesced per
  microtask, `epoch++` once per sweep) and each `b.sweep()` that finds a
  change writes its own `hole`/`attr` chunk or op. **The delimiter's shape.**
  What the sink emits: the sweep as one unit — `sweep()` collects the pass's
  changed bindings per frame and writes one chunk `{ type: "ops", id,
  version, ops: [{ type: "hole", key, html, … }, { type: "attr", key, attrs,
  … }] }` on the stream face (one wire line; `FrameChunk` gains the member)
  and one `sc:live` op of the same shape on the document face; a sweep that
  changes one binding emits as today (the pin's control holds either way).
  What the client batches on: the chunk's edge — `applyFrames.drain` and
  `applyLiveOp` pass it through unchanged; `chunkToRecords` merges the
  members' records into one map (≈ +40 B, shared with 3.5's batched drain);
  `FrameImpl.apply` already writes a multi-record `FrameWrite.r` and flushes
  **once** — one hole pass, one `#applied(version, "morph")`, one
  `frame:applied` — so the unit the sink coalesced is the unit the page
  shows. No buffering, no timeout for a sweep a connection died inside, no
  sweep-id correlation. The `liveOps` catch-up log (last-value-wins per
  `type:fid:key`) flattens an `ops` op into its members (≈ +30 B). The server
  arm — `sweep()` collecting instead of writing — is unestimated here. Wire:
  a new `FrameChunk` / `sc:live` member, RFC 11 addendum. Rejected: a
  `sweep-end` marker with client-side buffering — a second ledger, a timeout,
  and a correlation the chunk's edge gives for free. **Server half.**
- **3.6 (ii)** — the producer holding a trace's patches until the response
  ends; named for completeness, not recommended (3.6).
- **3.3's fix is here** (corollary 4 inward): the document face's fragment
  error path (`web/src/server.ts:2911`, the blank `" "` template) renders
  the boundary's error outcome into the fragment as the stream face's
  `meta.error` path (`frame-sink.ts:588`) already does; C12 (c) flips with
  it. **3.4**'s server-side normalization; **2c** (DR-4) re-records the 146
  artifacts.
- **Settles-once as promise-of-snapshot; live-if-live** (the product
  questions' principle answers) — the sink's tier decision, DR-2.
- **Nothing in seams 1–2's client steps changes the wire**: 1a–1d and 2a–2b
  read the same chunks, keys and markers; `onStream`/`resolve`/`preview` are
  client-side options and `@internal` signatures (flagged above as public
  surface, not as wire).

**Not these seams.** The asset-loader mirror (audit S10: route through `web`'s
registry via `client.ts`'s import edge — a style gate is a hold in the
contract's vocabulary, but it defers a reveal, not a claim, and is counted
through the fragment ledger already); regions as store substructure (audit
S7, the three rename sites); store eviction (§3 4). No red touches them.

### The server half — drafts (2026-10-06; design, no wire change shipped)

Three items the client pass could not close, each with the server-side
shape it needs. None is coded; each is a design note the server PR follows.
The savings pass's A6 is this section.

**(i) C13 — the sweep delimiter (R7).** _Status on the client after
#3830:_ the client's unit of application is already the write —
`FrameImpl.apply(write)` takes a multi-record `FrameWrite.r` and flushes
once (one hole pass, one `#applied`, one `frame:applied`), and the host's
landing fan-out uses it (the version's whole record set in one apply). What
is missing is only the wire's edge. _The draft (unchanged from above):_ the
sink's `sweep()` collects the pass's changed bindings per frame and writes
one chunk `{ type: "ops", id, version, ops: [{ type: "hole", … }, { type:
"attr", … }] }` on the stream face and one `sc:live` op of the same shape on
the document face; `chunkToRecords` merges the members' records into one
map (≈ +40 B); `applyFrames.drain` and `applyLiveOp` pass the chunk through
unchanged; the `liveOps` catch-up log flattens an `ops` op into its members
(≈ +30 B). A sweep that changes one binding emits as today. Wire: a new
`FrameChunk` / `sc:live` member — RFC 11 addendum. _Pin to write against
the draft:_ `c13-sweep-atomic` (a, b) as they stand — they flip when the
sink emits the member. _Rejected:_ a `sweep-end` marker with client-side
buffering (a second ledger, a timeout, a correlation the chunk's edge gives
for free).

**(ii) The plain-response streaming bound** (the savings pass's decision
4). A plain server function whose SC reads a generator source keeps its
response open (`server.ts` `if (!holds) queue(flushEnd)`; `complete` only
at settle) and each later yield arrives as a `hole` / `attr` chunk — with
no `live` declaration anywhere (re-attribution §1.3a). The bound the
response ends at is today "the source settles", which for a generator that
never returns is never. _The draft:_ `complete` gains `bound: "yields" |
"time"` (the sink's choice per response: after the first flush's yields
have drained, or after a configured interval), and the sink ends a plain
response at the bound; a `live()` response is unbounded by declaration. The
client needs nothing — a `complete` is a landing already (`landing`
resolves on it), and later yields the bound cut off are what `live()`
exists to carry. Wire: a new optional member on the `complete` chunk — RFC
11 addendum; absent means today's behaviour. _Pin to write:_ a plain
response over a generator source completes at the bound; a `live()`
response does not.

**(iii) C12 (c) — the rejected server `<Loading>`'s error template (3.3's
server half).** _The gap, located:_ `web/src/server.ts`'s fragment
resolver (the `done` closure returned by `registerFragment`) hands
`sink.fragment` a `" "` template on the error path (`value !== undefined ?
value : " "`) and rejects `<key>_fr`; `frame-sink.ts:fragment` reveals that
same `value` and adds a keyed `error` chunk. For a boundary with a client
twin the blank is harmless — `hydratedCreateLoadingBoundary`'s `s === 2`
arm resumes fresh and renders the nearest client `<Errored>` over it. For a
server component's boundary there is no twin: the blank is what shows
(#3833's c2 pin). _The shape:_ the server `<Loading>` (`solid/src/server/
hydration.ts`, `finalizeError`) already holds the enclosing `parentHandler`
— pre-flush the failure is met by it (an `<Errored>` rendering its
fallback, into the shell); post-flush its only output channel is the
fragment's template. The fix renders the error outcome INTO the template:
`done(renderErrorOutcome(err), err)` where the outcome is the nearest
server `<Errored>`'s fallback for the error, rendered as a string under the
boundary's owner; with no server `<Errored>` the error escapes the server
component and the whole response is the frame's `:error` (the outward face
— the enclosing client `<Errored>` sees one errored async value, as today
through the gate's error apply). _Two decisions the server PR must make:_
(1) the fallback renders in the `<Loading>`'s position, not the
`<Errored>`'s — the Errored's subtree is already in the shell, so its
fallback replacing only the placeholder is the one layout the fragment can
express; state it as the rule ("a post-flush error inside a server
component's `<Loading>` shows the nearest `<Errored>`'s fallback at the
boundary's position"); (2) hydration ids inside the rendered fallback — the
fallback must render under a scope that mints ids the client never claims
(the client has no twin to claim them: `NoHydration`'s shape, or the SC's
own suppressed-fill scope), and head/asset registrations it makes must be
dropped as the error path drops them today (`dropHeadBoundary`). Only when
the boundary is inside a server component render (no client twin can
exist): the client-twin case keeps the blank + the twin's fresh render.
_Not wire:_ the template's content is the server's to shape; `_fr` still
rejects (the diagnostic). _Pin:_ #3833's c2 flips when the template carries
the outcome.

---

## Order of work

Each step is one PR off `next`; its gate is **PR #3813** — the contract's
twenty-two `test.fails` and its harness: the step's named pins flip to `test`,
every other pin, the harness's laws (a survey campaign with the step's
invariants un-ignored surfaces nothing new) and the whole frames/hydration
suite stay green (`packages/web/test/consistency/`) — plus `scripts/size`
(every scenario ≤ its cap in `floor-caps.json`, the step's expected delta
stated in the PR and the caps lowered at landing — the ratchet). A step that
lands outside its band is the finding, not a failure to hide.

| # | step | rulings | pins flip | size expectation (min / ≈ br) | depends on |
| --- | --- | --- | --- | --- | --- |
| 0 | **PR #3813 lands** — the contract, its 22 `test.fails`, the harness | — | — | 0 | review |
| 1 | **3d** classification waits for the drain — **first: the only page-halting red** | 3.5 | C18 ×3 | ≈ +50 / +15 (≈ +90 / +25 with the batched drain) | nothing; the predicate is one term in `adoptBoundary.recordsPending`; the batch waits on the `ops` member if taken here |
| 2 | **3a** the frame's hold is a pending boundary — **unblocked by the 3.1 ruling** | 3.1 (ruled), 3.2, 3.5 | C3 (a), the harness's C3 replay; S1's C3 (b) on S1; **re-pin** S1's `hydration-end` spec | ≈ +125 / +35 (hydrating ≈ +8 br) | step 1 (the deferred set is right only once the drain's end is the bound); S1's `#heldRecords` as the set if S1 lands first, else the recordless defer alone |
| 3 | **2a** one applied record keyed by version | 2.1, 2.2 | C7 (c) | ≈ −70 / −20 on frames eager, both pages | nothing; smallest, self-contained in `FrameImpl` |
| 4 | **1a + 1b** response-owned data cells; records carry their resolver | 1.1–1.3 | C5 (a, b, e), C6 (a1, b2) | ≈ −340 / −100 | the `onStream`/`resolve` surface flagged and accepted (1.3 recommended-by-principle) |
| 5 | **1c** the store is one response's (full 1.4) | 1.4 | none; closes the class | ≈ −350 / −100 | the sink's A5 rule confirmed (the one wire fact still open) |
| 6 | **1d** one shell gate; per-address value | 1.5, 1.6 | C17 (a); C17 (c) under (i) | ≈ −50 / −15 | 1.6 (i) recommended-by-principle |
| 7 | **2b** the document reveal syncs (interim) | 2.3, 2.4 | C2 (a2, b), the harness's C2 replay, C4 (d) | ≈ +70 / +20 | 2.3 recommended-by-principle; DR-4 (**2c**) replaces it later as its own plan |
| 8 | **3e** the claim reads the snapshot, the backlog lands after — S1's third commit | 3.6 (iii) | C19 ×2 | 0 if S1 lands first; else ≈ +90 / +25 | 3.6's pick; 3.2's ordering pinned with 3a |
| 9 | **3c** id parity; **3b** dev report (client minimum) | 3.4, 3.3 | S1's `.fails`; C12 (c) flips with the **server half** (the document face renders the error outcome) | ≈ +40 / +10 (+30 dev) | the server's consumption pinned; the server-half PR for the fragment error path |

### As landed — the overnight pass (2026-10-06, draft PRs off `next` @ `49a8dca84`)

| step (plan)                                                         | PR                                                        | pins flipped (`test.fails` → `test`)                                             | frames eager (min / br, local, vs `next` 43,310 / 13,770) | note                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 / 3d — C18 (A0)                                                   | #3827 (another agent) — **closed 2026-10-06, superseded**  | C18 ×3 (there, by the predicate; in #3830 by `#` deciding the class)             | —                                                         | the two meet at the pins; both are right. Closed per the maintainer: under S-flush the occurrence name decides the class on every sync, so C18 is unrepresentable and the predicate's third term has nothing left to guard; 3.5's diagnosis (delivered is not drained) stands as the record.                                      |
| 4+6+3 / A1 — S-flush (1.5, 1.6 (i), 1.4 full, 2.1/2.2, 2.3 interim) | #3830 `fix/frames-s-flush-address-source`                 | C2 (b), C4 (d), C6 (a1, b2), C7 (c), C17 (a re-pinned, c), harness C2 ×1, C18 ×3 | **43,123 / 13,642 (−187 / −128)**                         | `FrameHost.landing(address)`; the store is one response's; `argsEquivalent`, `clearStreamRecords`, both hand-rolled gates, the re-arm/waiter deleted. **1b not done:** `preview` / `stage`'s client half / `#refArgsUnchanged` (≈ 1,300 B min) — the pull form is written in the PR; it needs the fills' props to read the token. |
| 2 / A2 — C3 (3.1 ruled, 3.2)                                        | #3831 `fix/frames-c3-hold-is-pending-boundary` (on #3830) | C3 (a), harness C3 ×1; campaign C3 280 → 0 / 268 → 0                             | 43,411 / 13,768 (+288 / +126 vs #3830)                    | `sharedConfig.holdBoundary` (solid, ≈ +59 B min on hydrating pages — over the 20 B allowance; **accepted by the maintainer 2026-10-06**, caps raised), `FrameOptions.hold`. Not done: `hydrateWindow` / R.claim's deletion, the 3e port (C19 ×2 stay red).                                                                                                             |
| 7 / A3 — C2 / C4 (2.3, 2.4)                                         | in #3830                                                  | C2 (b), C4 (d), harness C2 ×1                                                    | (in #3830's figure)                                       | the interim form (an empty write at the frame's version from the reveal cascade). Not done: R.reveal's readiness/retry deletion; DR-4 (2c). C2 (a2) is S-record's.                                                                                                                                                                |
| 4 / A4 — C5 (1.2)                                                   | #3832 `fix/frames-c5-data-response-scoped` (on #3830)     | C5 (a, b, e)                                                                     | 43,194 / 13,659 (+71 / +17 vs #3830)                      | the data path under the store's version guard. Not done: the per-response cell, S-ref (the pending `{$ref}` read), S-record.                                                                                                                                                                                                      |
| 9 / A5 — C12 (c) client half                                        | #3833 `fix/frames-c12-server-outcome` (on #3830)          | C12 (c) → c1 green (dev report), c2 red (server half)                            | 43,123 / 13,642 (±0)                                      | S-adopted documented, not built (+80 B solid).                                                                                                                                                                                                                                                                                    |
| A6 — server-half drafts                                             | this branch (docs)                                        | —                                                                                | —                                                         | C13 delimiter, the streaming bound, C12 (c)'s template — above.                                                                                                                                                                                                                                                                   |

Still red after the pass (on #3831 ∪ #3832 ∪ #3833 over #3830): C2 (a2 —
S-record), C12 (c2 — server half), C13 (a, b — wire), harness C19 ×2 (3e).
Harness, 500 cases, both seeds: only C19 remains (83 / 79 — up from 71 / 68
because cases that ended in C18/C2 now mount and reach the known R10
shape).

Expected end state after 1–8: **≈ −565 B min / ≈ −165 B br** on the frames
client with the full 1.4 and S1 landed (≈ −475 / −140 if step 8 ports S1's
park onto `next` instead) — frames eager, page base and page live all carry
it — and **≈ +8 br** on the hydrating scenario (was +30 under the draft's
`holdHydration` seam); **nineteen of the twenty-two pins flipped**, C12 (c)
with the server half (twenty), C13 (a, b) the server half's (twenty-two).
This sits inside the audit's C' estimate (≈ −1.8 KB br for the whole rulings
pass) as its consistency half; S7–S10's remaining items (regions, the asset
mirror, the markup half of S8) are the size half and need no ruling here.

---

## Public surface these fixes touch (to be accepted before the step that touches it)

All `@experimental` or `@internal`; none is wire.

- `ServerComponentHandlerOptions.onStream(address, version, response)` — step 4:
  the rotation it signalled becomes the response's cell install; delete or
  redefine.
- `FrameHostOptions.resolve(ref, frameId)` / `FrameHost.resolve(ref, frameId)` —
  step 4: no caller once records carry their resolver.
- `FrameHost.preview(chunk, resolve)` / `Frame.preview(records, resolve, inherited)`
  (`@internal`) — step 4: the `resolve` parameter goes.
- `STAGED_DATA` (`@internal`) — step 4: generalizes from "the staged response's
  data factory" to "every response's".
- A `Frame` sync hook for the document reveal — step 7: new, or kept internal
  through the spread-cast options seam `adoptBoundary` already uses.
- `FrameOptions.hold(): () => void` — step 2: option wired by `adoptBoundary`
  (internal use; flag as surface). `sharedConfig.resumeBoundary` (or an
  `internal` export of `initBoundaryResume`'s registration) — internal; **no
  new counter, no new done path** (3.1 ruled). The draft's
  `sharedConfig.holdHydration` is withdrawn.
- A multi-record `FrameChunk` member (`{ type: "ops", ops: [...] }`) — step 1
  only if the drain batches there; otherwise the server half's, as C13's
  delimiter. **This one is wire** (RFC 11 addendum), the only wire item in
  these steps.
- `FrameHostOptions.revive(value, claiming?)` / `FrameHost.revive`,
  `reviveContainerTraces(value, claiming?)`, `setContainerTraceMaterializer`'s
  second parameter — step 8: S1's surface (`9927ddddd`), flagged in S1.

`FrameOptions.onApply`'s detail, the store record keys, the DOM markers, the
hydration data keys and the `_$SC` bootstrap are unchanged by every step
above; `FrameChunk` is unchanged unless the `ops` member is taken.

**Touched by the overnight pass (2026-10-06), each flagged in its PR:**

- `FrameHost.landing(id): Promise<void> | undefined` — **new**
  (`@experimental`, #3830): the address-source seam.
- `FrameOptions.hold?(): () => void` — **new** (adopt path, wired by
  `adoptBoundary`; #3831).
- `sharedConfig.holdBoundary?(id): () => void` — **new**, `@internal` on
  `SharedConfig` (#3831).
- Behaviour, no signature change (#3830): `FrameOptions.recordsPending` is
  the poll's re-sync trigger, not a classifier; `createFrameHost.register`
  no longer calls `frame.rebase()` after a seed (the method stays); the
  host applies a synthetic `start` at an unstaged response's header; a
  version bump replaces the host and frame stores wholesale (slot records
  included — a producer must re-send them, as the sink does); a `data`
  chunk below the store's version is dropped (#3832).
- Untouched, pending 1b: `ServerComponentHandlerOptions.onStream`,
  `FrameHostOptions.resolve` / `FrameHost.resolve`, `FrameHost.preview` /
  `Frame.preview`, `STAGED_DATA`.

---

## Sources

- `documentation/server-components/frames-consistency-contract.md`
  (`spec/frames-consistency-contract` @ `681c96684`, **PR #3813**): C1–C19,
  §Red R1–R10, §Harness, §S1 delta, the pins' arms;
  `packages/web/test/consistency/c0{2,3,4,5,6,7}-*.spec.tsx`, `c12-*`,
  `c13-*`, `c17-*` (15 `test.fails`) and `harness/replay.spec.tsx` (7: C18 ×3,
  C19 ×2, C2 ×1, C3 ×1) — 22 in all.
- `size/s1-lazy-store-materializer` @ `9927ddddd` (third commit, "a held
  container-trace fill hydrates like a resident one"):
  `packages/web/test/hydration/container-trace-hold-{hydration-end,id-determinism,snapshot,interruption,record-retention}.spec.tsx`;
  `FrameImpl.#argsUnprepared`/`#heldRecords`/`#argsRefresh`;
  `materializeContainerTrace(marker, claiming)`'s park (`limit`,
  `afterHydration`), the `claiming` thread through `revive` →
  `reviveContainerTraces` → `materialize`.
- `documentation/plans/sc-layer-audit.md` (`size/sc-audit` @ `0bb67ff38`): §3
  rulings 1–75 (cited "§3 n"), §4 structural vs incidental, §6.3 the
  compatibility surface, §6.5 S7–S10, §7 open questions, Appendix A function
  sizes.
- Maintainer statements, 2026-10-05 (the Principle and the 3.1 ruling):
  "hydration ending should follow our Solid 2 non-SC"; "SCs are no different
  than other rendered data"; "SCs participate in `<Loading>` until their
  first flush the same way, and can have their own internal loading states
  that the client doesn't care about."
- `packages/signals/docs/SPEC-ASYNC-SEMANTICS.md` "The hold model — L2
  (2026-10-04)" rulings 1–9 (the voice; ruling 5 provenance at 1.3/1.5/1.6;
  ruling 1 at 2.1/C13), A15, A18 (supersession, provenance, store
  corollary), A19/A27, A28, A29 (#3540 boundary exemption), A30, A33, A5 —
  cited per ruling under `Restates:`; `documentation/solid-2.0/05-async-data.md`
  ("`Loading` is the UI boundary", the `on`/retain rule; "SSR and
  hydration: `ssrSource`" at 3.5/3.6); `packages/solid/src/client/hydration.ts`
  (`checkHydrationComplete`, `initBoundaryResume`, `fragmentPolicy`,
  `claimFragment`) at 3.1–3.3;
  `documentation/plans/size-reduction-carve-step1.md` §38 (the two-readings
  memo form), §40–§42 (rulings → fixes → re-pins → numbers).
- `documentation/server-components/server-components-principles.md` A0
  (equivalence, 2026-10-05 — this document's Principle in axiom form), A1–A7,
  L1 with their Solid 2 annotations, DR-2, DR-4, §4 rows 6, 14, 19, 20 and
  the 2026-10-05 note, §5.2.
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
