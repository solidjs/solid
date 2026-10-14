# Consistency harness

A small property-based harness over the frames/hydration consistency
contract (`documentation/server-components/frames-consistency-contract.md`).
It generates page shapes and event schedules for one server-component
boundary, drives them through the real runtime (`hydrate`, the frames
client, the shipped document reveal runtime — via `../support.ts`'s
`bootPage`), and checks the contract's invariants after every event.

## Run

Off by default (the campaign is `describe.skipIf(!process.env.CONSISTENCY_FUZZ)`);
`replay.spec.tsx` always runs with the consistency suite.

```sh
# survey (default): run every case, tally findings by invariant/law
CONSISTENCY_FUZZ=1 CONSISTENCY_SEED=3289 CONSISTENCY_CASES=500 \
  npx vitest run --config vite.config.hydrate.mjs test/consistency/harness

# look past known reds
CONSISTENCY_FUZZ=1 CONSISTENCY_SEED=91501 CONSISTENCY_CASES=500 CONSISTENCY_IGNORE=C3,C18 ...

# shrink: fail on the first finding outside CONSISTENCY_IGNORE and let
# fast-check reduce it; the minimal scenario prints as JSON
CONSISTENCY_FUZZ=1 CONSISTENCY_MODE=shrink CONSISTENCY_IGNORE=C3 ...

# or
pnpm consistency:fuzz
```

| env                  | default  | meaning                                              |
| -------------------- | -------- | ---------------------------------------------------- |
| `CONSISTENCY_FUZZ`   | unset    | enable the campaign                                  |
| `CONSISTENCY_SEED`   | `3289`   | fast-check seed                                      |
| `CONSISTENCY_CASES`  | `100`    | cases                                                |
| `CONSISTENCY_IGNORE` | empty    | comma list of invariant ids to look past             |
| `CONSISTENCY_MODE`   | `survey` | `survey` (tally all) or `shrink` (stop + reduce one) |

## Scenario language (`scenario.ts`)

```ts
interface Scenario {
  occurrences: Occurrence[]; // 1..4: render-prop `item#i` or direct-insert `children`
  fragments: Fragment[]; // 0..2 server <Loading> regions (pl-* placeholders)
  liveHole: boolean; // one <!--lh:N-->…<!--lh:/N--> range in the root content
  late: "none" | "dispose"; // dispose the mount at a random point after hydrate
  events: Event[]; // the schedule — a permutation of the required events
}
interface Occurrence {
  name: string;
  kind: "render" | "direct";
  arg: { kind: "plain" } | { kind: "trace"; snapshot: number; patches: number[] };
  inFragment: number | null;
}
type Event =
  | { t: "hydrate" } // once
  | { t: "record"; occ } // the occurrence's sc:slot record executes (render occurrences; once each)
  | { t: "reveal"; frag } // the fragment's content lands (template + $df + _fr settle; once each)
  | { t: "trace"; occ; patch } // one patch batch `[[["n"], value]]` for a trace arg (in order)
  | { t: "live"; html } // an sc:live hole op for the hole
  | { t: "tick" } // flush + one macrotask + flush (a settle point)
  | { t: "micro" } // one microtask
  | { t: "dispose" }; // the late action
```

The generator builds the shape, lists its required events in canonical
order, and shuffles them (`fc.shuffledSubarray`), then `normalize` restores
the two constraints a permutation may break (trace patches of one
occurrence stay in order; `dispose` follows `hydrate`). Shrinking moves the
schedule toward the canonical order, so a reduced counterexample reads as
"these events, in this order".

`describeScenario` prints one line: `[item#0 item#1trace(2,3)@f0 children] hole :: H R1 R0 V0 T1.0 L(ab) t X`
(`H` hydrate, `Rn` record, `Vn` reveal, `Tn.k` patch, `L(x)` live op, `t` tick, `m` micro, `X` dispose).

## Page construction (`run.tsx`)

- `fid = freshFid("fuzz")`; root `<ul>` holds the ranges of occurrences not in a
  fragment, then each fragment's placeholder; the live hole is a `<p>` after the list.
- Render occurrence `item#i` renders as `fillHtml2(fid, name, label, "0")` — the
  server render of `p => <li>{label(p)}{tick()}</li>` at tick 0, where the label
  is `p<i>` for a plain arg (`{ text: "p<i>" }`) or `t<i>=<n>` for a trace arg
  (`{ data: marker }`, the fill renders `${data.id}=${data.n}`). `children`
  renders as `<b _hk="sc-<fid>-children-0">0</b>` for `<Comp><b>{tick()}</b></Comp>`.
- Trace snapshots `{ id, n }` are emitted at boot (the document-face wire shape:
  the snapshot rides with the record); patches arrive as `trace` events.
- `document.readyState` is mocked `"loading"` while records/reveals are still
  owed (the parser is still running — what makes a recordless occurrence defer,
  #2968) and restored after the last one has run.
- The fill identifies its occurrence by one untracked read of its label; a fill
  evaluated with NO props (a render prop classified direct-insert) is counted
  separately and returns inert content so the other laws stay readable.
- At the end the schedule quiesces, the `tick` signal bumps to 1 (reactivity
  probe), and the page is cleaned up. Fragment keys and hole ids are namespaced
  per run (the fragment ledger and the live-op log are module-level).

## Oracle laws (`oracle.ts`)

Immediate (after every event):

| id  | law                    | states                                                   |
| --- | ---------------------- | -------------------------------------------------------- |
| G   | `no-runtime-error`     | nothing on `console.error`                               |
| C1  | `no-key-miss`          | no "Hydration key miss" warning                          |
| C1  | `no-unclaimed`         | no "unclaimed server-rendered" warning                   |
| C1  | `no-duplicate-fill`    | every live range holds ≤ 1 element                       |
| C1  | `node-identity`        | a server `_hk` node still in the tree is the same object |
| C4  | `invoke-once`          | ≤ 1 invocation per occurrence                            |
| C4  | `live-op-known-value`  | the hole shows the initial text or a pushed op           |
| C14 | `dispose-no-invoke`    | no fill invocation after dispose                         |
| C14 | `dispose-no-apply`     | no `frame:applied` after dispose                         |
| C18 | `classify-after-drain` | no render-prop fill evaluated as a zero-arg accessor     |

Settled (after a `tick`, and at the end):

| id      | law                                          | states                                                                                        |
| ------- | -------------------------------------------- | --------------------------------------------------------------------------------------------- |
| C11/C19 | `trace-equals-oracle` / `claim-shows-oracle` | a mounted trace fill shows snapshot + patches delivered (C19 when a patch preceded the claim) |
| C4      | `live-op-latest`                             | the hole shows the last pushed op                                                             |
| C12     | `fragment-parity`                            | pending: fallback in, content out; revealed: fallback out                                     |
| C14     | `dispose-host-cleared`                       | after dispose the host has no store for the boundary                                          |

End:

| id  | law                    | states                                                               |
| --- | ---------------------- | -------------------------------------------------------------------- |
| C3  | `done-counts-holds`    | at `onHydrationEnd` every mounted render occurrence had been invoked |
| C2  | `every-range-live`     | every live render range was invoked exactly once                     |
| C2  | `every-range-reactive` | after the bump every live range's second hole reads `1`              |

## Replay a counterexample

Copy the JSON the campaign printed into `replay.spec.tsx` as a
`test.fails("<Cn> <law>: <shape>", …)` asserting
`findings.filter(f => f.id === "Cn")` is empty, so the pin is red for the
right reason, with the observed/expected in a comment. Add the other order
where the invariant claims independence, and a passing control.

## Limitations

- One boundary per page; no stream face (refetch/args switch) — those are the
  C5/C6/C13/C15/C17 pins' business.
- `_hydrationDone` is a worker-level latch set by the first completed hydrate
  pass, so every case after the first runs in the post-done regime
  (pre-done reveal-before-hydrate is C2(c1)'s pin).
- Trace snapshots are always emitted before the record executes; "snapshot
  after record" is not generated.
- The parser's clock is a mock: `readyState` flips to complete synchronously
  after the last owed record/reveal, which is the tightest realistic timing
  (the tail of a response parsed in one go before a timer fires).
