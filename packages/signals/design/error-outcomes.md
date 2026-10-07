# Reactive outcome representation and publication

Original audit target: `next` at `53ef0e69`, subsequently rebased and checked
against `bc51ada9` and rebased onto `d231b991`, plus this branch's outcome changes. This is a
source audit and regression study, not a proof of the scheduler or the complete
DOM/outside-read law.

## Outcomes, frames and successful history

An answer is a successful payload or a user failure. Pending is an availability
condition, not a failure. Each observing frame needs its own published answer,
separate from the proposed answer being derived. An Error fulfilled as data is
still data; any JavaScript value, including undefined, can be thrown.

Successful payloads stay unboxed:

| Storage                                       | Meaning                                                                                                                                                    |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `_value`                                      | Published successful payload and memo's successful `prev` history. Retained across failures; does not by itself identify the published outcome.            |
| `_pendingValue`                               | Proposed successful payload; NOT_PENDING means no payload staging. A projection can recover without staging a payload on its controlling computation.      |
| `_statusFlags`, `_x._error`                   | Proposed availability/failure. STATUS_ERROR selects a source-tagged StatusError with the exact user cause; NotReadyError represents pending control flow.  |
| CONFIG_COMMITTED_ERROR, `_x._committedError`  | Published failure, independent of proposed status. Retained during retry and held recovery; replaced at the same commit gate as successful answers.        |
| `_x._lane`, `_x._laneError`                   | Successful payload and published failure of an optimistic/derived lane. A written guess supplies its own successful answer while masking underlying truth. |
| `_x._snapshotValue`, CONFIG_SNAPSHOT_ERROR    | Captured successful payload or tagged failure for snapshot scopes. The existing slot captures either outcome; no extra snapshot field is added.            |
| `_x._flushed`                                 | Successful staging retained for A28 mid-tick visibility, not an outcome discriminator.                                                                     |
| `_x._inFlight`, `_pendingSources`, `_blocked` | Flight identity, outstanding origins and retry obligation. These remain separate from terminal outcomes.                                                   |
| effect `_prevValue`                           | Successful compute payload supplied to the success callback. The error callback has a separate arm.                                                        |

The two new error references live in the lazily allocated extension, with one
shared shape. Healthy scalar signals do not allocate it just for this feature.
Computations still allocate no Result object per successful evaluation. This is
additional storage when an extension exists, not a memory-saving change. Five
isolated local V8 probes measured approximately 360 bytes per lazy memo without
an extension in both versions, and 512 → 528 bytes with one (including accessor
and array storage). These are local retained-heap measurements, not a guarantee
for other engines.

## Read selection and publication

Ordinary outside reads of the truth frame and children-forbidden observers
interpret the published outcome. Derivations interpret proposed outcomes; a proposed failure therefore
throws during derivation while its side-effect callback waits for reveal.
Render observers retain the existing frame/mount rules. Outcome selection follows
those rules rather than exposing the current working error before choosing a
frame.

For an initialized truth-frame source held by a rendered async sibling:

| Proposed answer                                      | Published answer                | Ordinary outside read    | isPending                                           |
| ---------------------------------------------------- | ------------------------------- | ------------------------ | --------------------------------------------------- |
| new failure                                          | old success                     | old success              | true                                                |
| pending retry                                        | failure                         | throws published failure | true, unless the existing quiet re-ask rule applies |
| successful recovery, even equal to last good payload | failure                         | throws published failure | true                                                |
| different failure                                    | old failure                     | throws old failure       | true                                                |
| frame revealed                                       | newly published success/failure | new value or new failure | false                                               |

A born-held node without a published answer remains NotReady until reveal,
including when its first request has already rejected. Independent requests are
not globally entangled merely because both are initially loading.
For an async first pass over a hold, next's #3800 direction rule applies:
the first load does not keep the birth frame open. Its successful or failed
answer joins that frame only if it is still live at settlement; otherwise the
answer publishes independently.

Verdict reads select a stale render reader's published frame before interpreting
proposed errors. All remaining failed proposals pass through one failure gate,
including born-held failures with no successful staging. A snapshot may capture
only a published answer: an uninitialized held memo's `_value` is a placeholder,
not a successful `undefined`. A first synchronous failure published directly at
creation also closes the loading seed window before a retry can run in the first
flush; successful seed/`prev` history remains separate from accessor outcomes.
Born-held creation retains an already published loading seed for both successful
and failed proposals. A queued user callback can precede the end of the creation
pass, when its frame membership becomes known; an unpublished user effect's
runner hands that first callback to the frame's existing queue while held.
This applies after recovery too. Initialized callbacks keep the selected
lane's reveal rules even when ordinary truth remains held; mount-time render
work retains its separate DOM-construction rules.

`latest` selects the proposed view, including failures and successful recovery.
It retains next's existing optimistic/view behavior; this branch does not redefine
all ordinary/latest imperative visibility. In particular, an outside read of a
lane-backed accessor still uses next's proposed lane view, which can disagree
with held DOM. Errors now follow that same selected view instead of bypassing it.
This remains the previously accepted intentional inconsistency; it must not be
confused with fixing the truth-frame outside-read mismatch. A lane's shown failure survives its
own pending correction just like its shown successful payload. Dissolving a lane
transfers the shown outcome with the shown payload. A snapshot captures either
outcome; its boundary must wait on captured status rather than live source status.
Boundary plumbing itself is not a frozen source: its nested fallback/content
structure must be able to resume during hydration. Its source reads still use
captured outcomes.

A `loadingValue` is a successful initial answer. A revealed failure ends its
initial seed window, just as a revealed success does. The seed can remain the last
successful `prev` passed into a retry, but retaining it for `prev` does not make it
resurface in accessor reads. Errors are never supplied as memo `prev` values.

A direct write to an unheld writable memo supplies a successful proposal, even
if its derivation previously failed. It clears the working terminal failure but
keeps the published failure until the proposal commits. During a pending retry,
the existing manual-write flag identifies the successful staged answer at that
commit: it can replace the published failure without claiming the outstanding
request has finished. Pending availability remains, and the request's eventual
answer still lands normally. This matches the existing successful-payload
control. A write into another frame's held derivation instead becomes successful
`prev` history for its re-derivation (A34); it does not publish a temporary manual
value. Regressions cover initial and later failures, same-payload writes, retry
pendingness, and held recovery.

Async comparator failures use the same flight-error handler as rejection. Status
propagation removes dependents' pending entries; the error release sweep must
then retire lazy readers that lost their last subscriber during the request.
Calling only `notifyStatus` skipped that release and retained their cleanup and
source subscriptions indefinitely. Successful fulfillment and promise rejection
serve as paired observation-lifecycle controls.

## Package audit map

| Files                                                                                                                     | Responsibility                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core/core.ts`, `core/async.ts`, `core/types.ts`, `core/constants.ts`                                                     | Create, stage and select outcomes. Sync throws, promise/iterator rejection and comparator failure use the same origin/status protocol. Error recovery is an outcome change even when payload equality says unchanged. Born-held pending computations retain their frame for a first rejection.                        |
| `core/scheduler.ts`, `core/effect.ts`                                                                                     | Publish terminal outcomes at commit, retaining published failures during pending retries. Both effect callback arms share scope, exception containment and final bookkeeping; error handlers retain explicit cleanup control.                                                                                         |
| `core/lanes.ts`, `core/verdict.ts`                                                                                        | Select an optimistic/verdict view before interpreting failure; retain the shown lane failure separately. isPending compares outcomes as well as successful payloads, including projection recovery without a payload staging.                                                                                         |
| `boundaries.ts`, `reveal.ts`                                                                                              | Convert failure/unavailability into fallback output, preserving user cause. Only NotReadyError suspends Loading. Keep the tree subscription while waiting on a fallback, and prune snapshot readers against captured outcomes. Mount visibility and reveal-order machinery otherwise retain their existing contracts. |
| `store/store.ts`, `store/projection.ts`, `store/target.ts`, `store/types.ts`                                              | Leaves carry field payloads; the family controller carries failure. Its read gate applies through held recovery as well as current failure. Sync and async failure share family notification so existing leaf readers learn both failure and recovery.                                                                |
| `store/optimistic.ts`, `store/reconcile.ts`, `store/storePath.ts`, `store/utils.ts`, `store/affects.ts`, `store/index.ts` | Payload/backing/arrangement and overlay operations. Failure stays at the family/controller gate rather than replacing every leaf with an error object.                                                                                                                                                                |
| `signals.ts`, `core/action.ts`                                                                                            | resolve/until/refresh apply the foreign-frame delivery gate to fulfillment and rejection. A waiter inside its own action can still settle without waiting on itself. Abort/timeout/action errors retain separate control channels.                                                                                    |
| `affects.ts`                                                                                                              | Reachability/availability marks. A revealed failure is settled although its accessor throws; a held outcome transition can remain pending.                                                                                                                                                                            |
| `map.ts`, `flatten.ts`                                                                                                    | Collection/content derivations propagate through core reads rather than manufacturing replacement success from failure.                                                                                                                                                                                               |
| `core/error.ts`, diagnostic/attribution helpers                                                                           | Preserve exact cause and origin. Best-effort formatting contains hostile coercion without replacing the original thrown value. Stack capture retains upstream behavior.                                                                                                                                               |

## Regressions and limits

Regressions cover held callbacks, outside reads in both directions, different
successive failures, same-payload recovery, falsy errors, latest derivations,
projection readers, snapshot success/failure, born-held first rejection,
loadingValue/prev separation, boundaries, cancellation, fulfilled Error data and
promise-delivery timing. Browser controls exercise real compiled JSX and connected
DOM in development and production.

The audit also found synchronous projection notification, foreign-frame rejection
delivery and hostile diagnostic formatting gaps on the unmodified audit target.
They are fixed in this branch along with the original held-latest and callback
recovery failures. The earlier intentional held latest/isPending imperative-view
differences are not claimed fixed by this error-outcome change.

No performance or memory improvement is claimed. Earlier node-field packing
prototypes were rejected because of slower healthy-update medians or larger
bundles. Successful-payload history and availability remain explicit; boxing every
success or replacing `_value` with an exception would add healthy-path cost or
lose required history. These regressions are not new Bend/kernel proofs.
