# Todos — TodoMVC as a client app

TodoMVC built the client-side way: the browser holds the list, renders every
element, and talks to an API. It sits in the client-owned, request/response
corner of the examples, beside `hackernews-spa`.

Its twin is [../todos-server](../todos-server), the same app with the list
rendered on the server. It is also the baseline for the planned `board`
example, which keeps this client ownership and adds a live data tier.

The part to read is [src/todos.ts](./src/todos.ts): fetching, per-item
optimistic writes, per-item errors with retry, and bulk actions, layered by
how the primitives compose. What it exercises:

- **`createOptimisticStore` (derived form)** — async projection that re-fetches via `refresh(todos)`; the optimistic overlay covers each in-flight action.
- **`action` generators** — every mutation is an `action(function* () { ... })` so writes between yields are batched into a single transition.
- **Per-item retry affordance** — failed toggles/removes leave the item visible with an error label and a `retry` button. Action failures are recorded in a plain JS `Errors` map and re-applied inside the projection function on each `refresh(todos)`; the entries live *under* the optimistic overlay (in the projection's output, not in the action's optimistic write), so they survive overlay reverts naturally.
- **Top-level `<Errored>` boundary** — catches any unhandled render-time error in the tree, with a `reset` button.
- **`<Loading>` boundary** — renders a fallback while the initial `getTodos()` projection settles.
- **Filters via hash routing** — `createHashFilter()`, an owner-scoped primitive (signal + `onSettled`-attached `hashchange` listener with cleanup), no router needed and no module-scope reactive state.
- **`toggleAll` / `clearCompleted`** — bulk actions that yield API calls one at a time and refresh once at the end.

The mock API in `src/api.ts` persists to `localStorage` and rejects ~33% of writes, so the error path is exercised regularly without any extra setup.

## Run

```bash
pnpm install
pnpm --filter todos-example build
pnpm --filter todos-example start
```

Then open <http://localhost:3002>.

For the dev server (HMR via the plugin's refresh pipeline):

```bash
pnpm --filter todos-example dev
```
