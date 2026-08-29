# Audit brief — rounds 6–8 + patch-mode default flip

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
