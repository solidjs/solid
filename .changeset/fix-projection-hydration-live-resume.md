---
"@solidjs/signals": patch
"solid-js": patch
---

Fix async-generator projections (and memos) freezing after SSR hydration (#3060)

A `createProjection`/`createMemo` driven by an async generator that settled
during SSR never resumed on the client: after hydration, a dependency change
or `refresh()` re-ran the adoption wrapper, which orphaned a fresh generator
via subFetch and handed back the already-consumed serialized replay — the
node froze at its SSR value forever. The adoption wrappers now track the
serialized stream's terminal state (done/error): re-runs before the terminal
are NotReady retries of the same flight and keep adopting the replay; re-runs
after it hand over to the live user compute.

Two deeper bugs surfaced by the fix:

- Projection drafts are now proxies over a fake target (the store's own
  TargetShape trick) instead of the store proxy itself. Spec invariant
  validation runs against a proxy's target after each trap returns — outside
  the draft's write-override bracket — so `Object.keys(state)` in a derive
  continuation re-entered the store's ownKeys, hit the seed-invisibility
  firewall gate, and re-threw the projection's own pending NotReadyError into
  the derive. The draft traps (including new ownKeys / getOwnPropertyDescriptor /
  defineProperty coverage) forward to the store inside the bracket; invariants
  only ever see the dummy.

- The store replay's first-pull thenable swallowed exceptions thrown while
  applying the SSR snapshot (the rejection landed on a derived promise nobody
  observed), silently killing the drain and wedging boundary hydration open.
  Failures now route to the flight's rejection and surface through the normal
  error channel.
