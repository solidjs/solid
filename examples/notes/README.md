# Notes — Solid Server Components + Single-Flight Mutations

The [React server-components notes demo](https://github.com/reactjs/server-components-demo),
ported to **Solid Server Components** with the same server/client split: the
sidebar list and the note viewer render on the server and arrive as HTML;
the browser gets the shell, the router, the search field, the
expand/collapse behavior, and the editor.

Where the HackerNews twin ([../hackernews](../hackernews)) is read-only, this
example adds **mutations** — and every save and delete is *single-flight*: one
round trip whose response carries the redirect, the invalidated data, and the
invalidated server-rendered regions together.

```sh
pnpm dev                  # http://localhost:3006
pnpm build && pnpm start  # http://localhost:3006
```

Notes live in an in-memory store ([src/server/db.ts](./src/server/db.ts),
unstorage's memory driver), so the app seeds itself on boot and a restart
resets it.

## The split, next to the React demo

- [src/app.tsx](./src/app.tsx) — `App.js`. The shell: static chrome, the
  search field and the New button, and two boundaries (the list and the
  route outlet). Unlike the original demo, navigation does **not** re-render
  the app — the list and the note refresh independently while the shell
  stands still.
- [src/router.tsx](./src/router.tsx) — `NoteList.js` and `SidebarNote.js`,
  plus the route table. `getNoteList` is the sidebar as a server component:
  each note's header and excerpt are server markup handed into the
  [SidebarNoteContent](./src/components/SidebarNoteContent.tsx) client slot,
  which owns expand/collapse, the active highlight, and the title-change
  flash. `$key={note.id}` gives each occurrence entity identity, so when a
  mutation reorders the list, that client state follows the note rather than
  the position. As in the demo, the title travels twice: as the `title` prop
  the flash watches and in the header markup.
- [src/routes/note.tsx](./src/routes/note.tsx) — `Note.js`. The demo switched
  one component on `isEditing`; here each mode is its own route. The preview
  route is a server component (the markdown renders on the server); the edit
  route needs the note's raw text as data, so `getNoteEdit` is a plain query
  answering the note itself.
- [src/components/NoteEditor.tsx](./src/components/NoteEditor.tsx) —
  `NoteEditor.js`, and the save and delete actions it posts. Each answers
  with `redirect()`, and that redirect is what powers single-flight.
- [src/components/SearchField.tsx](./src/components/SearchField.tsx) —
  `SearchField.js`: a client component writing the `searchText` query param.

## What to look at

**One request per mutation.** Open devtools → network and save a note. There
is a single `POST` to `/_server`, and its response is a frame stream carrying
the redirect target, the fresh sidebar list, and the fresh note view — markup
regions and data folded into the mutation's own response. No follow-up
refetch. The router lands on the new URL and every affected boundary morphs
in place, while an open editor keeps its draft.

**Each excerpt ships once.** A note's excerpt is only mounted while it is
expanded, as in the demo. The server does not send collapsed excerpts as
hidden markup: view source and each one is an `sc:region` record in the
serialized data instead. Expand a note with the network tab open and no
request goes out — the client mounts the excerpt from that record.

**The markdown library never ships for reading.** Notes render to HTML on the
server (`NotePreview` inside the note route's server component), so `marked`
is absent from the initial client bundle. Only the editor's live preview
needs it in the browser, so the editor routes are `lazy()`
([src/router.tsx](./src/router.tsx)) and the chunk downloads when you head to
`/new` or an edit page — the router even warms it on link hover. This is the
same code-splitting story the React demo made its centerpiece.

**Search is client + server together.** The search field writes a query
param; the list it filters is a server component keyed by that param. Typing
re-calls `getNoteList(searchText)` and the sidebar boundary morphs — the
expanded/collapsed state of surviving notes stays put, because `$key` keeps
their client slots attached.

## How single-flight is wired

The pieces are deliberately small, and match the fullstack template:

- [src/router.tsx](./src/router.tsx) — the queries and the routes that
  preload them, in their own module so it has two consumers: the shell
  renders this Router, and…
- [src/server-config.ts](./src/server-config.ts) — …the server-function
  handler registers the router's flight collector over the same instance.
  When an action returns `redirect()`, the collector reruns the destination's
  server route and preloads in data-only mode and folds everything they
  produce — server component markup as frame regions, plain values as data —
  into the mutation's response.
- [vite.config.ts](./vite.config.ts) — the same turnkey setup as the
  HackerNews twin plus one line: `serverFunctions.configure` names the module
  above. `components: true` is still the only flag that turns on server
  components.

No revalidation keys are named anywhere: the actions refresh whatever the
destination shows, which is the original demo's "refetch the app" semantics —
paid only for the regions that actually appear.
