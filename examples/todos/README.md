# Solid 2.0 Todos

A small TodoMVC built on Solid 2.0 to exercise the patterns AI tools and humans most commonly need to write:

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

For a watch build:

```bash
pnpm --filter todos-example dev
```
