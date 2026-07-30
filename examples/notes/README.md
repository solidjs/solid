# Notes — Solid Server Components + Single-Flight Mutations

The [React server-components notes demo](https://github.com/reactjs/server-components-demo),
ported to **Solid Server Components** with the same server/client split: the
app shell, the sidebar list, and the note viewer render on the server and
arrive as HTML; the browser gets the router, the search field, the
expand/collapse behavior, and the editor.

Where the HackerNews twin ([../hackernews](../hackernews)) is read-only, this
example adds **mutations** — and every save and delete is *single-flight*: one
round trip whose response carries the redirect, the invalidated data, and the
invalidated server-rendered regions together.

```sh
pnpm dev                  # http://localhost:5173
pnpm build && pnpm start  # http://localhost:3005
```

Notes live in an in-memory store ([src/lib/db.ts](./src/lib/db.ts), unstorage's
memory driver), so the app seeds itself on boot and a restart resets it.

## The split, next to the React demo

- [src/server/App.tsx](./src/server/App.tsx) — `App.server.js`. The shell as a
  server component: static chrome with four client positions (search, the New
  button, the list, the route outlet). Unlike the original demo, navigation
  does **not** re-render this tree — the list and the note are independent
  boundaries that refresh fine-grained while the shell stands still.
- [src/server/NoteList.tsx](./src/server/NoteList.tsx) — `NoteList.server.js`
  and `SidebarNote.js` in one module. Each note's header and excerpt are
  server markup handed into the
  [SidebarNoteContent](./src/components/SidebarNoteContent.tsx) client slot,
  which owns expand/collapse, the active highlight, and the title-change
  flash. `$key={note.id}` gives each occurrence entity identity, so when a
  mutation reorders the list, that client state follows the note rather than
  the position.
- [src/server/Note.tsx](./src/server/Note.tsx) — `Note.server.js`. The demo
  switched one component on `isEditing`; here each mode is its own route, so
  each is its own server component: `noteView` renders the markdown preview on
  the server, `noteEditView` fills the
  [NoteEditor](./src/components/NoteEditor.tsx) client slot with the note's
  raw text.
- [src/server/actions.ts](./src/server/actions.ts) — the mutations. Each
  answers with `redirect()`, and that redirect is what powers single-flight.

## What to look at

**One request per mutation.** Open devtools → network and save a note. There
is a single `POST` to `/_server`, and its response is a frame stream carrying
the redirect target, the fresh sidebar list, and the fresh note view — markup
regions and data folded into the mutation's own response. No follow-up
refetch. The router lands on the new URL and every affected boundary morphs
in place.

**The markdown library never ships for reading.** Notes render to HTML on the
server (`NotePreview` inside `noteView`), so `marked` is absent from the
initial client bundle. Only the editor's live preview needs it in the browser,
so the editor routes are `lazy()` ([src/routes.ts](./src/routes.ts)) and the
chunk downloads when you head to `/new` or an edit page — the router even
warms it on link hover. This is the same code-splitting story the React demo
made its centerpiece.

**Search is client + server together.**
[SearchField](./src/components/SearchField.tsx) is a client component writing
a query param; the list it filters is a server component keyed by that param.
Typing re-calls `noteListView(searchText)` and the sidebar boundary morphs —
the expanded/collapsed state of surviving notes stays put, because `$key`
keeps their client slots attached.

## How single-flight is wired

The pieces are deliberately small:

- [src/lib/api.ts](./src/lib/api.ts) — the server components wrapped in the
  router's `query()` (cache identity, preload participation, and the names
  flight collection is keyed by); the mutations wrapped in `action()`.
- [src/routes.ts](./src/routes.ts) — routes declare `preload`s that call those
  queries. This module has two consumers: the app root builds the Router from
  it, and…
- [src/server-config.ts](./src/server-config.ts) — …the server-function
  handler registers the router's flight collector over the same routes. When
  an action returns `redirect()`, the collector reruns the destination's
  preloads in data-only mode and folds everything they produce — server
  component markup as frame regions, plain values as data — into the
  mutation's response.
- [vite.config.ts](./vite.config.ts) — the same turnkey setup as the
  HackerNews twin plus one line: `serverFunctions.configure` names the module
  above. `components: true` is still the only flag that turns on server
  components.

No revalidation keys are named anywhere: the actions refresh whatever the
destination shows, which is the original demo's "refetch the app" semantics —
paid only for the regions that actually appear.
