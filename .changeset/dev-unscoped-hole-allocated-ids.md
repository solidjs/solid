---
"@solidjs/web": patch
"solid-js": patch
"@solidjs/signals": patch
---

Dev diagnostic `UNSCOPED_HOLE_ALLOCATED_IDS`: an unscoped hole that took hydration ids at a position the other side does not share (#3567 follow-up)

The one hydration-key gap left after #3599 is a bare identifier bound to a function — `const renderHead = () => props.header; <div>{renderHead}</div>`. The compiler sees a value and scopes nothing; both runtimes unwrap the function, but not at the same point (the client's `insert` at the statement, the server's `ssr()` inside the walk after every scoped sibling reserved its slot), so the keys of the hole's content and of the holes after it permute. `JSX.Element` excludes functions in 2.0, so type-checked code cannot write this hole; by ruling it is **not** scoped (no production cost for a shape the types reject). Instead the dev builds detect the permutation and raise `UNSCOPED_HOLE_ALLOCATED_IDS` (`warn`, kind `render`, once per site) on both server render and client hydrate. The server reports structurally — the counter's next id when the hole was registered (`data.registered`) differs from the one it was evaluated at (`data.before`, `data.after` after it ran); the client, which always builds in place, reports when the content it built inside an unscoped function hole moved the counter and missed a server-rendered key. A function hole with nothing scoped after it lands on the same ids on both sides and stays silent (a boundary's zero-arity `fallback={() => <F />}` thunk built by the consuming hole is that shape). `data.name` is the function; the message names the fix: call the function at the hole (`{renderHead()}`) or pass the built value. Scoped holes, memo and component accessors, `children()`, `<For>` rows and the runtime's own children inserts never raise it.

Plumbing: a dev-only `sharedConfig.devPeekNextContextId()` on both `solid-js` facades (the next child id of the current owner, read without consuming — on the server without materializing a pending hole slot), installed under the dev gate so the prod and observe artifacts of `solid-js` and `@solidjs/web` are byte-identical to before.
