# Audit brief — rounds 6–9 + patch-mode default flip + node delivery

## Round 10.5 FIXES (2026-08-31) — response to the 6-variant follow-up

- **F1 (the flagged regression): pending-dedup is now transition-aware.**
  Under an active transition every bump reaches `setSignal` — entanglement
  and merging are scheduler bookkeeping keyed on writes, and dedup never
  outranks the scheduler. Outside transitions the dedup (and the dbmon
  walk economics it exists for) is unchanged. Conservative fix; coverage
  is the existing transition-merge invariants (a deterministic
  A-resolves-while-B-pends repro was not reduced — flag it again if the
  scenario survives this).
- **F2: alias currency probe.** `deepPathsPlain` with a target now probes
  interior RAW steps against the family map — a slot holding a backing its
  target has since adopted away from is a stale alias path and DECLINES to
  classic (proxy reads stay right). Eager path-copying keeps canonical
  chains current; this closes the second-parent alias.
- **F3 (RED-verified): payload-less deliveries re-probe the deep
  manifest.** A child-subject adoption can carry a getter into a path only
  the ANCESTOR's manifest reads; the bubbled (payload-less) delivery now
  probes and demotes, so the getter evaluates tracked. dbmon ticks are all
  payload hits — zero probe cost on the hot path.
- **F4: demoted entries are severed** (`u`) so a boundary-held deferred
  callback (or any straggler snapshot) skips them — no duplicate untracked
  application after demote-then-redrive.
- **F5: resyncs honor the bound family.** `identityOps` rebuilds when the
  subject's family differs from the family the retained rows were built
  under (`boundFam`, advanced only by a fully successful apply — a
  throwing swap build leaves it old, so recovery rebuilds).
- **F6: shallow swaps keep raw retention** (no family-bound row
  registrations; classic parity for DOM identity/focus).
- **F7: optimistic double-bubble removed** — revert sites emit ONCE (the
  primitive self-gates and bubbles), and the tentative walk-level bubble
  is gone (the tentative gate's own emission bubbles).

Gates: 1,420 signals / 687 web / 352 SSR / 150 hydrate / 32 tasks; sizes
under limits; dbmon 6.6 / 2.1 / 0.6 (unchanged).

## Round 10 FIXES (2026-08-31) — response to the 7-P1 audit

All seven blockers and the three follow-ups addressed, harness-first (four
new signals invariants + four new driver invariants, each RED pre-fix).
The STRUCTURAL move: emission stopped being a per-seam convention.

- **Bubbling is primitive-owned** (P1 landings, P1 optimistic writes, and
  the standing class): every bump walks the ancestor chain inside
  `bumpOne`/`bumpOneOptimistic` — no emission seam decides about
  ancestors, so none can forget. Pending-dedup (`bc !== dv` exits in two
  reads) keeps N-row walks from multiplying signal writes; `emitPatchLocal`
  is now literally `emitPatch`. The channel-less landing seam bubbles
  explicitly, as does the demotion branch.
- **Deep-path mounts** (P1-1): fixed at the SOURCE, not the reader — eager
  child adoptions path-copy the ancestor chain (`privatizeCommitted`),
  exactly like the fold drain always did for queued adoptions. The
  committed raw a mount reads is always current. (The first attempt —
  proxy-reading deep-path initial applies — cost +8 ms dbmon mount by
  wrapping every nested object per row; reverted, lesson recorded.)
- **Boundary holds** (P1-4): dispatch defers a held registrant's entry
  INTO its owner queue (probe injected by boundaries.ts — null when no
  boundary machinery loads; entries re-apply from the queue at release,
  reading that moment's visible view). Render-effect parity by
  construction; regression is parity-shaped (reveal-order composition).
- **Demotion fanout** (P1-5): per-entry isolation with the dispatch loop's
  own error routing (`routeEntryError` shared), one deferred halt after
  all healthy siblings are live.
- **Swap visibility** (P1-6): subject swaps build from the OPTIMISTIC
  visible array (initial-engagement parity). **Family retention** (P1-7):
  `storeFamilyOf` token gates identity retention — a family change
  rebuilds rows instead of keeping DOM bound to channels the new subject
  never emits on.
- **P2s**: the dmq latch dies with its consumers (cleared at last unbind,
  consumed inert, and a registration that STARTS a list opens a fresh
  generation); consumer-less built channels stop bumping outside
  transitions (the held-window pin is transition-scoped); retired queue
  fields deleted from the channel shape, all node-delivery fields declared
  and initialized in `pcOf`.
- Finding downgraded during repro: direct setter writes on optimistic
  stores OUTSIDE an action revert by design (they are overrides of derived
  truth) — two audit-adjacent "swallowed write" repros were this
  semantic, not defects.

Gates: 1,419 signals / 687 web / 352 SSR / 150 hydrate / 32 turbo tasks;
sizes under limits (one ratchet: store-heavy hydrating tier 26.45 →
26.55 kB, measured 26.47). dbmon unchanged: 6.5 / 2.0 / 0.6.

## Round 10 — node-delivery architecture (SUPERSEDES value-queue delivery)

Branch `patch-node-delivery-proto`. Value patches no longer ride bespoke
queues: each channel owns one version SIGNAL (`pc.dn`) bumped at emission
seams and ONE detached render effect that dispatches every consumer with a
per-entry `prev` baseline. Transitions, holds, lanes, merges, and mount
order are scheduler-owned by construction. Structural (row-ops/slot) queues
are unchanged from rounds 6–9. The following round-9 mechanisms are
RETIRED — findings against them are moot: generation/`cm` skip rules,
`qa/qe/qo/qeo` value stamps and `clearStamp`, drain-side accessor probes
(`deepProbeFails`/`optProbeFails`), `forcedNext`, value-entry transition
merge repair (merge is now a plain structural move).

### New seams (attack surface)

1. **Lazy machinery creation** (`bumpDelivery`): signal + effect are built
   at the first consumer-visible emission, skipped iff machinery was never
   built AND `pc.p === null`. Soundness pin: once built, NEVER torn down —
   a held write bumping during an unbound window must deliver to a
   consumer registering before the settle. Never-built channels skip
   silently (registration `pv` baselines reflect prior writes).
2. **Never-dispose persistence**: last unbind only nulls `pc.p`; the node
   takes the inert return on later bumps; re-registrations reuse it;
   reclamation is by record death (node↔signal cycle is GC-collectable).
   Perf-over-memory ruling: ~200 B dormant per record outliving consumers.
3. **`deliveryEffect` primitive** (core/effect.ts): detached single-source
   effect — no root, no owner, created under `runWithOwner(null)` (global
   queue). Initial run is a subscribe-only no-op (`bc === dv` guard).
   Errors route per-entry to registrant owners inside the commit; an
   unboundaried error defers `haltReactivity` one phase (siblings apply).
4. **Payload fast path** (`pc.np`/`pc.npb`): self emissions stash raw next
   state bc-tagged; deliveries read it raw, else resolve `visibleView`
   (optimistic proxy / deep-path proxy / held mask / committed). A stash
   without a bump (no-consumer window) can never false-match: `np` is only
   served when `npb === bc` and any later bump increments `bc`.
5. **Per-entry `pv` baselines**: REFERENCES to raw backings (adoption swaps
   make them immutable); the in-place overlay fold clones just-in-time
   (`prepareInPlaceFold`); optimistic views snapshot UNTRACKED through the
   proxy. The compare IS the delivery decision — no counters.
6. **Deferred demotion** (`pc.dmq`): tentative getter-bearing views mark
   the channel; the delivery effect (clean, lane-timed context) runs
   `demoteToEffects` so re-driven bodies subscribe correctly.

### Evidence

- Full gates green: 1,415 signals / 683 web / 352 SSR / 150 hydrate / 32
  turbo tasks; every size scenario UNDER its channel-era limit (net
  smaller: core −157 B, store tier −112 B, patchDriver tier −169 B).
- Perf A/B vs the audited channel state (36d1d385), same session:
  dbmon ties or wins every op (mount 6.4=6.4, tick 2.1<2.2, remount
  4.6<5.0); jfb 10 ops parity; uibench 96 scenarios parity (34.4 vs 35.2
  summed medians). Unmount bench column shown to be a concurrent-GC
  write-barrier artifact, identical on both builds (design doc §22).

## Round 9 (response to the 11-finding audit)

- **P1 gen-stale mounts** — the skip rule now applies only to entries
  emitted from COMMITTED-VISIBLE state (`cm`: setter drafts, held
  adoptions, and transaction stashes never skip); `patchableRaw` serves the
  held view (`hv`) for masked targets, and mounts anchor to the same
  visibility an untracked proxy reader sees (invariant test uses that
  oracle directly). Ambient eager adoptions self-correct (mounts read the
  swapped backing) — pinned by test.
- **P1 optimistic-window mounts** — manifested initial applies read the
  OPTIMISTIC VIEW через the proxy (untracked) for family records.
- **P1 fallback compute writes** — the manifest IS the read set: the
  effect fallback's compute pass reads the declared envelope directly and
  never runs the body (NaN/unstable-getter compares can fire setters
  inside tracked computations). Applied to web AND universal drivers;
  manifest-less callers keep dual-run.
- **P1 tentative accessor safety** — tentative reconciles now emit the
  TENTATIVE VIEW on the record's own channel at lane timing (they
  previously never told the channel at all — effects saw the view, patches
  did not); the optimistic drain probes non-forced payloads and demotes
  getter-bearing views IMMEDIATELY (the global render queue is stashed
  in-flight, so deferral would postpone visibility to settle).
- **P1 stamp granularity** — forced entries clear only the stamp they hold
  (lane vs settle); transition merges retarget/dedupe forced stamps.
- **P1 isWrappable guard** on captured-record binds; **P1 server entry**
  exports patchDriver (notSup, same class as template) and rowProof
  (identity — callable in isomorphic modules); **P1 function
  intermediates** demote conservatively (accessor carriers, never plain);
  **P1 safe-integer keys** only (both compilers — 1e20 formats divergently
  through the i64 mirror).
- **P2 unchanged reconciles** don't bubble (identity-skip mirrored at the
  top); **P2 merge** repairs forced stamps (above).

CI: the attribution warn-count flake is fixed two-sided (the harness mutes
its expected demotion warnings; the attribution test counts its own
diagnostic's warns, not the process-global total).

dbmon: 6.3 / 2.1 / 0.6 — within noise of rounds 7-8. Sizes ratcheted with
dated notes (~+0.2-0.4 kB per tier).

**Architectural note (for the next design conversation):** most P1s across
rounds 7-9 are visibility-rule divergences — the channel bypasses the
reactive graph, so every visibility rule nodes enforce implicitly is
replicated by hand at each seam. Two structural candidates are on the
table: centralizing visibleView()/shouldDeliver() decisions, or
NODE-DRIVEN DELIVERY (one hidden node per patched record; compiled bodies
unchanged) which would inherit transition/lane/hold timing by
construction. The latter is being prototyped before the next round.

---

## Round 8 (response to the 8-finding audit)

- **P1 admission nested getters** — `patchableRaw` deep-probes the manifest
  at registration; getter-bearing paths take the tracked fallback from the
  start. Admission also reads the COMMITTED backing (root cause under the
  P2 duplicate-apply finding: `pb ?? v` leaked deferred transition drafts to
  mid-transition mounts).
- **P1 structural builds** — rows bind their operation's CAPTURED record
  (`patchProxyFor` resolves raws through the list target's wrap, riding a
  createTarget-installed hook: a direct wrapNext import would retain the
  whole trap engine in store-less bundles — +3.7 kB, caught by the size
  gate).
- **P1 tentative ancestor bubble** — lane-timed forced entries for
  in-flight visibility PLUS settle-held twins (revert/landing re-applies
  resolved truth to ancestor expressions).
- **P1 renderer surface** — `rowProof` on createRenderer (identity —
  universal keeps classic lists), Renderer type, README; contract test pins
  the whole patch tier.
- **P1 decimal keys** — non-integer numeric keys statically ineligible
  (both compilers), same class as dotted string keys.
- **P2 duplicate applies** — generation-stamped entries: consumers
  registered after emission (initialized from that state) are skipped;
  transition releases exempt themselves (their late consumers saw the
  pre-commit view). The fold path was verified UNREACHABLE for this
  (the walk queues value entries before structural ops by design — test
  pins it); the cross-queue optimistic window was real.
- **P2 forced coalescing** — one forced ancestor re-apply per container per
  batch (`qf`/`qfo` stamps), effect parity.
- **P2 universal untrack** — commit phase untracked, matching web.

dbmon: identical to round-7 finals (mount 6.4, tick 2.0, partial 0.5 —
quiet machine, both orders). Byte cost ~+0.3 kB store apps / +0.3 kB patch
tiers, ratcheted with notes.

---

## Round 7 (response to the 9-finding audit)

All nine findings verified against a RED invariant harness first (commit
order: harness → fixes), then fixed:

- **P1 recording completeness** — runtime recording replaced by a
  compiler-emitted STATIC read manifest (both compilers, hoisted `_mf$`
  arrays, interned by identity at registration). Deep paths probe as a
  prefix tree at adoption gates and forced applies; targeted reconciles now
  bubble ancestors; forced applies for deep-path channels read through the
  proxy (eager adoption does not rewrite ancestor raw slots). Bare-subject
  reads and dotted string keys are statically ineligible. Residue:
  manifest-less hand-written `registerPatch` callers keep best-effort
  recording (documented).
- **P1 sticky sc** — adoption gates probe the emission's ACTUAL object
  (incoming/just-committed), statelessly.
- **P1 prototype getters** — non-plain prototypes reject admission (class
  instances keep tracked effects); overlay drafts still work over class
  prototypes (own-key scan semantics unchanged).
- **P1 renderer surface** — `Renderer` type + README + `createRenderer`
  re-export list now include `patchDriver`; contract tests pin compiled
  imports ⊆ documented surfaces per generate mode. (Verified: universal
  output never imports patch symbols; the link-break class was dom-generate
  custom runtimes, same as any dom runtime surface addition.)
- **P1 structural late registrants** — structural queues snapshot entry
  refs at emission (unbinds still sever via shared `u` marks); VALUE queues
  are the documented dual — they resolve the consumer list LIVE at drain
  (fixes the merge/recreated-list miss) and coalesce across same-flush
  releases (effect-parity oracle tests).
- **P1 slot rebuild atomicity** — build-before-destroy; a throwing
  replacement leaves the old row mounted AND live.
- **P2 hydration region** — a throwing claim removes completed, claimed,
  and trailing server rows.
- **P2 stamp collision** — normal/optimistic queues coalesce on separate
  stamp pairs.
- **P2 merge collision list** — subsumed by live value-list resolution.

New permanent infrastructure: `patch-invariants.test.ts` (channel
contracts), `for.patchinvariants.spec.tsx` + hydration slice (driver throw-
atomicity matrix over every build entry point), `renderer-contract.test.js`
(imports ⊆ surface), and PINV-1..3 per-flush ledger checks wired into the
`__TEST__` invariant infra.

Perf: quiet-machine dbmon tick 2.1 ms (round-6: 1.9; classic: 6.7) — the
+0.2 is the deep-path probe, taken twice through the profiler (manifest
interning + prefix-tree probing + leaf inlining recovered the initial 2.5).
Mount ~7.2–7.5 vs 6.4 pre-audit; the final hoisting pass eliminated the
remaining intern misses per the profile but needs a quiet-machine
confirmation run (a parallel build was loading the box).

---

# Original brief — round 6 + default flip

**Scope:** `next..patch-hardening-r6`. Two bodies of work: (A) fixes for the
six round-6 findings against `adf10e9b`, (B) the patch-mode DEFAULT-ON flip
(both compilers). Everything below states what changed, the soundness claim,
and — most useful to attack — the *reasoning* each claim depends on.

## A. Round-6 findings

### A1. Prod-sound getter demotion (was: dev-only — reverted)
The dev-only trade is gone. Design: **accessed-key recording + bounded
probes**.
- `patchDriver` (web) runs the registration-time initial force-apply through
  a recording `Proxy` and hands the read set to `registerPatch(record, fn,
  keys)`. Hydration registrations (no initial apply) record at their FIRST
  drain apply instead (`applyEntries`, `entry.k`).
- The channel unions keys into `pc.ak` (deduped array). Both adoption
  emission seams (reconcile walk, fold commit) gate on `targetKeysPlain`:
  probe ONLY `ak`'s keys for own getters on the adopted backing; `ak === null`
  (registered-but-never-applied) falls back to the full scan.
- **Claim to attack #1:** the recorded set is COMPLETE because patch bodies
  are grammar-guaranteed sequences of `if (force || n.k !== p.k) { write
  reading n.k }` — under force the COMPARES short-circuit but every WRITE
  executes and reads its keys; under non-force first applies the compares
  read both sides. Is there any compiled body shape whose key read is
  conditional on something other than `force`/compare? (Eligibility grammar:
  pure member chains of one subject — check `wrapPatchMode` emission shapes.)
- **Claim to attack #2:** `ak` is a UNION across registrations and never
  shrinks; adoption probes are `O(|ak|)` per patched-record adoption.
  Measured on dbmon: tick 1.8 ms vs 1.7 no-check vs 1.9 full-scan (midday
  machine; re-measure welcome).

### A2. Transition-merge collisions coalesce (`scheduler.ts`)
Same-channel entries in BOTH stashes now merge to ONE entry that resolves
`next` LIVE at drain (`entry.t = pc.t`, drain reads `t.pb ?? t.v`), keeping
the destination's `prev`. **Attack:** the `prev` choice — both captures are
committed pre-write values of the same record; are there merge orders where
they differ and the kept one is wrong? Also the opaque backref contract
(core mutating `entry.pc.qa/qe/t`) — is any other holder of these fields
surprised?

### A3. Row/slot queued work respects unbinds (`patch.ts`)
Emitters no longer clone wrapper entries; queue items carry the LIVE
registration list plus payload (`ops` / `si`), dispatched by
`applyStructural` with the same unbound-mark (`entry.u`) + disposed-owner
checks and error routing as value patches. **Attack:** ordering — value
entries and structural entries interleave in emission order; the live-list
change means late registrations see earlier-queued structural work. Driver
double-applies? (registerRowOps consumers are driver-internal only.)

### A4. Dispatch windows (`applyEntries`)
Snapshot for multi-consumer lists; FIXED length window + undefined guard for
the single-consumer alias (a callback registering another patch mid-dispatch
must not run it in the same drain — it just received its initial apply).
**Attack:** entry removed mid-dispatch shifts the aliased single-entry list —
covered by the undefined guard?

### A5. Initial list construction severs on throw (`patch-driver.ts`)
Client + hydration first-build loops now sever completed rows' registrations
AND the throwing row's partials, remove inserted/claimed DOM (including the
claimed server row under hydration), dispose the list owner, rethrow.
**Attack:** `patchCount` accounting across sever-then-rethrow; boundary
remount re-engagement.

### A6. Failed-apply recovery is ACTIVE (`patch-driver.ts`)
`resyncNeeded` + slot ticks now trigger an immediate identity resync (deep
value-only recovery still waits for the next list event — documented).
Identity swaps register the new subject's channels BEFORE the apply.
**Attack:** resync loops when the poison row keeps throwing (flag stays set,
retried per event — bounded?).

## B. Default flip (patch mode ON)

- Babel `config.patchDriver: "patchDriver"`; Rust `patch_driver` resolves
  `Wrapper::Default` like every other wrapper (opt out: `false`). The JS
  loader already normalizes `true`/absent.
- All Babel dom fixture outputs regenerated; parity tier `dom-patch`
  replaced by `dom-nopatch` (fences the explicit opt-out — plain `dom` now
  covers patch grammar). Byte parity previously held on the whole corpus
  with patch on (108/108, zero ratchet files).
- **Attack:** anything still assuming dormancy — treeshake/metafile tests,
  size-scenario notes, docs, the `driveList` "compiler is default-on"
  comments (now true), octane fixture flags (now redundant), the loader's
  `patchDriver: true` normalization interacting with default-on.
- Known accepted costs (ruled by Ryan at flip-preview time): ~+1.5 kB brotli
  typical apps (value tier), ~+3.6 kB store-list apps, portal-swarm ~5%
  effect-fallback tax on signal-only mount churn.

## Standing accepted trades (pre-existing, documented)
- Keyless rows: adoption pairs positionally, ops rebuild — content-correct,
  retention churn (design §21a).
- Demoted LIST-ROW bodies re-drive under the list owner (per-row severing
  lost for demoted rows) — §20.
- Deep value-only recovery after a failed apply waits for the next list
  event (A6).

## Test map
- `packages/signals/tests/store/patch-channel.test.ts` — channel semantics,
  all rounds' regressions (31+ tests).
- `packages/web/test/for.patchlist.spec.tsx` — driver incl. exception
  atomicity, severing, recovery (15+ tests).
- `packages/web/test/for.equivalence.spec.tsx` — driver ≡ classic matrix.
- `packages/compiler/__tests__/parity*` — Babel↔Oxc byte parity (dom =
  patch-on, dom-nopatch = opt-out).
