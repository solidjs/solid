# Audit brief — round 6 + patch-mode default flip

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
