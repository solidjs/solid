# Generic hydration harness

The frames-free arm of the consistency contract
(`documentation/server-components/frames-consistency-contract.md`, §"Generic
hydration — classification and pins"). Same idea as `../harness` — a
fast-check schedule generator plus an oracle of the contract's laws — over a
PLAIN Solid 2 page: `hydrate()` of a `renderToStream` document with two
sibling streamed `<Loading>` boundaries reading module-level state
(`test/harness/generic-hydration.tsx`). No frames, slots or records.

## Run

```sh
# the pins (always on): reds as test.fails, controls and holds as test
npx vitest run --config vite.config.hydrate.mjs test/consistency/generic

# the campaign (opt-in), same knobs as ../harness
CONSISTENCY_FUZZ=1 CONSISTENCY_SEED=3289 CONSISTENCY_CASES=500 \
  npx vitest run --config vite.config.hydrate.mjs test/consistency/generic
CONSISTENCY_FUZZ=1 CONSISTENCY_SEED=91501 CONSISTENCY_CASES=500 CONSISTENCY_IGNORE=C1,C9,C19,E ...
CONSISTENCY_FUZZ=1 CONSISTENCY_MODE=shrink CONSISTENCY_IGNORE=C19 ...

# replaying: GENERIC_DEBUG=1 prints the page and the sources after every step
GENERIC_DEBUG=1 npx vitest run --config vite.config.hydrate.mjs test/consistency/generic/replay.spec.tsx -t "GH4" --silent=false
```

The page's server render is an artifact: `test/harness/__artifacts__/
generic-hydration-{ab,ba}.json` (`{ shell, chunks }`, one per fragment
order), written by `test/server/generic-hydration.gen.spec.tsx` under the
server config. Regenerate it after changing the shared page:

```sh
npx vitest run --config vite.config.server.mjs test/server/generic-hydration.gen.spec.tsx
```

## Scenario (`scenario.ts`)

`[order] :: H C0 W C1 t P C2 Ea X` — `H` hydrate, `Cn` the stream's n-th
chunk parses (markup appended, scripts run; wire order kept), `W` a client
write to the module-level signal (`setPath("/b")`), `P` a push to the
module-level store list, `Ea`/`Eb` a click on a boundary's button (queued by
the bootstrap-shaped capture if its range is not claimed yet), `t` a settle
(20ms — an in-flight client async re-run lands), `m` a microtask, `X` dispose.
`W`, `P` and `X` are normalized after `H` (a write before `hydrate()` is an
app mismatch, outside the contract).

## Laws (`run.tsx`)

| when      | id  | law                                                             |
| --------- | --- | --------------------------------------------------------------- |
| immediate | G   | `no-runtime-error`                                              |
| immediate | C1  | `no-key-miss`, `no-unclaimed`, `node-identity`, `no-duplicate`  |
| immediate | C9  | `no-fallback-over-settled` (a client fallback after the reveal) |
| immediate | C3  | `in-progress-until-done`                                        |
| immediate | C14 | `dispose-no-invoke`, `dispose-no-dom`                           |
| settled   | C12 | `fragment-parity`                                               |
| settled   | C19 | `claim-shows-signal` / `-memo` / `-async-memo` / `-store-list`  |
| end       | C3  | `done-counts-holds`                                             |
| end       | C2  | `every-range-live`, `every-range-reactive`                      |
| end       | E   | `queued-click-replays-once`                                     |

## Limitations

One page shape; the server's chunking is fixed per order; `_hydrationDone`
is a worker latch (every case after the first runs post-done — a reveal
before `hydrate()` is held and replayed at registration); `readyState` is
not mocked.
