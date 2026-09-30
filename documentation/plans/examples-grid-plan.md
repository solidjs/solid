# Examples Plan — one idiomatic app per grid coordinate

_Drafted 2026-09-28, from the fit conversation that produced principles §10
and §9.6, with Stages 1–8 built and #3704 (attribute slots, second form)
the last heavy feature. Status: DIRECTION AGREED in conversation; nothing
here is built. This page is the checklist for the example set as a whole;
the two flagships get their own plans (linked below) and this page does not
design them. Design record:
`documentation/server-components/server-components-principles.md` §10 (fit)
and §9.6 (live mutations seed). The grid is the one in
["The Grand Unifying Architecture of Frontend"](https://dev.to/playfulprogramming/the-grand-unifying-architecture-of-frontend-bhk)
(dev.to, 2026-09-22): response window on the horizontal axis
(request/response → persistent), affordance weight on the vertical
(server-owned markup → client-owned state), and three responsibilities every
app separates — navigation (client), content (server), affordances
(client). Owner: Ryan._

## Objective

The examples were built as test beds, one per feature, and that was the
right way to build the features. Now that the feature set is complete they
should become **good examples**: one idiomatic app per coordinate on the
grid, each the app it would be if the framework didn't need proving, with
`rendering` remaining the one deliberate kitchen sink. Two of them are
flagships — realistic products, not demos — because the right half of the
grid is where no one else has a story and an AI chat and a board are the
two apps people are actually building there.

## The bar (every example)

Priority order; a lower item never overrides a higher one.

1. **One coordinate.** The README's first paragraph names it and names the
   example's twin (the same app at another coordinate) where one exists.
2. **The app's own affordances and nothing else.** Every feature present is
   one the app would have if the competitors didn't exist. Features with no
   idiomatic home live in specs, not examples — that absence is evidence
   for principles §10.5, not a gap to fill.
3. **The three responsibilities visible.** Which elements the compiler
   claims (navigation), which functions are content (`"use server"`), and
   what the overlay is (affordances) should be readable from the source
   without a tour.
4. **Lead with the affordance that is hardest elsewhere.** Among the app's
   natural affordances, the README and the polish go to the _layering
   moment_ — the place where client behaviour on server markup is one line
   here and a DSL, a controller, or a round trip in Datastar, Turbo +
   Stimulus, or LiveView. By demonstration only: READMEs stay neutral and
   name no competitor; the head-to-head is an article.

The trivial case must stay trivial: one client position with no per-item
data is one line each side (`codeBlock={() => ({ onCopy })}` on the client,
`onClick={block.onCopy}` on the server). A stateless fill is the object
literal; a fill that owns state is its signals plus the literal. No example
may need more; where one does, that is a §9.2.3 ergonomics finding to
raise, not something example code hides.

**Authoring layout** (decided 2026-09-29, every example with a server
side, twins included). One screen is one file; the directive marks the
server part in place:

- A server component is a function-level `"use server"` inside its client
  wrapper, in the file that uses it:
  `const getStory = query(async (id: string) => { "use server"; … }, "story")`.
  The binding is the wrapper, so the name is the server function's name
  (`getStory`, as any server function is named) and there is no second
  name to invent. Actions likewise (`action(async (…) => { "use server"; … })`).
- The route file holds the screen: its query with the server component
  inline, server-only helpers the component renders (a recursive
  `Comment`), the slot's type, and the route component with its fills
  inline. Everything referenced only from `"use server"` bodies is pruned
  from the client build.
- A route file exports only what the router reads — its default component
  and `preload`. The query, helpers and types stay module-private; a query
  is exported only when another screen shares it.
- `src/server/` holds only server-only modules (`hn.ts` and its capture,
  `db.ts`), each beginning `import "server-only";` — the vite plugin's
  boundary marker, which fails the build if the module reaches a client
  bundle — and imported by namespace (`hn.getStory`, `db.getTodos`), so
  the data layer echoing the server function's name reads as intended.
  Mixed files (the route files) never import the marker. Inline in a mixed
  file goes only markup and helpers whose leak would be harmless; secrets,
  server APIs and heavy data live behind the marker.
- `src/` is otherwise client and flat: `app.tsx`, `routes/`, `types.ts`.
  No `lib/`, no `api.ts`; `components/` only when there are client
  components.

Verified against the toolchain (not yet by an example build): the
directive pass extracts an inline `"use server"` inside `query(…)` and
names it from the enclosing binding (`getStory-<hash>`, not an anonymous
ordinal — stable across reordering); a module-level helper and a
namespace import used only by server bodies are absent from the client
output (compiler fixtures `nested-functions`, `dead-code-scoped`, and a
direct run of the route-file shape); `serverFunctions.components` installs
its result transforms globally and turns on `serverComponents` for every
SSR compile, so neither depends on the directive's level; a non-exported
wrapper registers exactly as an exported one. The first example PR
confirms with its build: passing with the `server-only` markers in place
(pruning precedes resolution) and failing on a deliberate client import.
_Confirmed by `hackernews`' build (2026-09-29): both hold, the references
are named from their bindings (`getStory-<hash>`, the same in both twins),
and a module with the marker needs
`/// <reference types="@solidjs/vite-plugin/boundary-modules" />` in
`vite-env.d.ts`, since TypeScript 6 rejects an undeclared side-effect
import (TS2882)._

## The map

```text
                 request/response                       persistent
              ┌──────────────────────────────┬──────────────────────────────┐
 client-heavy │ hackernews-spa   SPA + JSON  │ board            FLAGSHIP    │
 (affordances)│ todos            SPA + optim │   live data tier, optimistic │
              │                              │   store, until, drag,        │
              │                              │   presence                   │
              ├──────────────────────────────┼──────────────────────────────┤
   (islands)  │ notes            RSC coord.  │                              │
              │   islands + single-flight    │                              │
              ├──────────────────────────────┼──────────────────────────────┤
 server-heavy │ hackernews       reads       │ chat             FLAGSHIP    │
 (markup)     │ todos-server     writes      │   live server components,    │
              │                              │   durable generation, threads│
              └──────────────────────────────┴──────────────────────────────┘
 off-grid: rendering (SSR-mode kitchen sink) · effect (data tier × Effect)
           · sierpinski (renderer perf) · migrating-element (conditional, §V5)
 retired:  room (both pages absorbed by the flagships)
```

Twins: `hackernews` ↔ `hackernews-spa`; `todos-server` ↔ `todos`. The
realistic pair on the right (`board`, `chat`) mirrors the pedagogical pair
on the left (`hackernews`, `notes`), and is its own comparison: the same
primitives with the client owning the markup (`board`) and with the server
owning it (`chat`).

## Per-example disposition

### `hackernews` — bottom-left, reads. KEEP; collapse → `<details>`, server routes, layout, README. Built 2026-09-29

The front door: the simplest server component, navigation over server
markup, and no client code. Revised in review (2026-09-29): the collapse only
hides replies, which is native `<details>`, so a binding slot there was a
heavier way to do what the browser already does. Both twins now render the
same `<details>`, every route in this twin is a server route, and the client
ships the router, the loading boundary, and a navigation dim
(`useIsRouting()`) that both twins share. The binding-slot demos are
`todos-server` and `chat`'s copy button (`notes`' search field was one until
its shell moved to the client; see `notes` below).

Closed (2026-09-30): the proof that no content is sent twice when a client
component places server content conditionally (occlusion: an unplaced region
ships as an `sc:region:` record, never as markup too) had no end-to-end test.
The early demo showed it live (`b3f48999e`, deep replies collapsed by
default) and `63cd06688` dropped it when the collapse became
`display: none`; the only spec, `frames-occlusion-client.spec.tsx`, fed the
client hand-written records. `test/server/frame-occlusion-document.spec.tsx`
now covers the server side (each excerpt once: markup where placed, a record
where not; late placement locked to records), and
`test/hydration/frame-occlusion-document.spec.tsx` the client (adopt, then
expand, collapse and re-expand with the network stubbed to throw; each text
on screen once). `notes`' sidebar excerpt is the live demo.

The superseded binding-slot shape, as reviewed and first built:

Target shape (reviewed 2026-09-29): the recursive `Comment` is a server
component and the client never sees the tree — per comment with replies, one
`props.toggle({ $key: c.id })` call whose properties bind the toggle's
`open` class, its `onClick`, its label (text position, G1) and the replies'
`display`. The fill is the SPA twin's `Toggle` almost line for line, under
G2's execution model: a signal in the fill body (it runs once per
occurrence), getters over it, `onToggle` as a plain handler; `$key` makes
the state follow the comment across refetches and die with it, as in the
SPA. No store, no client components. Markup stays byte-identical to the
twin's. In the authoring layout the screen is `routes/story.tsx` —
`getStory` with the server component inline, `Comment`, the `Toggle`
bindings interface and `ToggleSlot`, the route component with the fill
inline — over `server/hn.ts`; `lib/`, `views.tsx`, `api.ts` and
`components/` go. Example-local fixes riding along: `CommentDefinition`
gains the `id` the data already carries; the README's "`$key` keeps it
attached" claim becomes true (today no key is passed); the bundle check
can grep `comment-children` too.

_As built:_ the shape above, with `StoryDefinition.id` also typed `number`
(the capture and the live API both carry numbers). The thread's markup is
byte-identical to the twin's with hydration and slot markers stripped
(feed and user pages too); 652 of the 1,406 comments have replies, so 652
fills. In the browser the collapsed state keeps its element and text node
through a `revalidate("story")` refetch. The bundle check greps the client
JavaScript, since `app.css` carries both class names.

Follow-up in review: the feeds and the user page are server routes
(`serverRouteComponent`, router 2.0.0-next.31), so they have no route
component and no `preload`. The feeds are one `/:type?` route filtered to
the five feed names, with `page` from a hand-written search schema; the SPA
twin mirrors the pattern and filter and parses `?page` itself. (The story
route kept its component for the fill until the move to `<details>`, when it
became a server route too.) The nav is outside `Loading`,
since it does no I/O. Router next.29 broke client navigation to the user
page: it sent a schema-less route's args as `{ params, search: undefined }`,
which the JSON argument check rejects, and nothing was logged. next.30
(#615) fixed that, so every example that uses the router moved to next.31.

### `hackernews-spa` — top-left. KEEP; layout only. Built 2026-09-29

The twin; exists only as the comparison. README names the coordinate. Takes
the authoring layout: each route file's `query` carries its server function
inline over `server/hn.ts` (a plain server-only module, no longer a
module-level `"use server"` file). Diffing the twins then shows the thesis
at the route file: the same `getStory`, returning JSON in one and markup in
the other, and client components in one only.

### `notes` — middle-left, the RSC coordinate. KEEP; authoring layout + README. Built 2026-09-30

React's own server-components demo ported: client islands whose state
survives server updates around them, and single-flight mutations by
redirect. Its layering moment is the editor keeping its draft while the
sidebar list refreshes around it — the "shared client state preserved" line
the HTML-partial tools cannot cross. The code is in the authoring layout
(queries and actions inline in the files that use them, `server/` for
`db.ts`) and the README names the coordinate. The overlap with `chat` (both
are sidebar + viewer + mutations) is intentional: opposite sides of the grid,
different audience.

Revised in review (2026-09-30), toward React's own shape:

- The shell is a client component, as React's `App.js` is. Only the sidebar
  list and the note preview are server components. The server shell had
  existed only to host a binding slot: once the shell was on the client,
  the search field was a client component, as it is in the demo. Finding:
  a binding slot needs a position inside server markup, and in this app the
  only such positions are the per-note ones `SidebarNoteContent` already
  owns.
- The editor's data is a plain query returning the note (`getNoteEdit`).
  Before, it was a server component used as a data loader, filling the
  editor slot with raw text.
- The excerpt mounts only while expanded, as in the demo, so collapsed
  excerpts ship once as records (the occlusion specs above).
- `router.tsx` holds the route table, the root preload and `getNoteList`,
  and `server-config.ts` passes that Router to the flight collector. This is
  the fullstack template's layout. The collector takes a router instance
  because not every app uses Solid Router; each router template does this
  wiring itself.

### `todos` — top-left. KEEP; README + small cleanups. Built 2026-09-30

The SPA control: optimistic store over `refresh`, client-held API mock.
Twin of `todos-server`; also the pedagogical control for `board`. No server
side, so the authoring layout does not apply. The pass: the README names the
coordinate and the twin; Vite 8, as in the other grid examples; the error
map moves into `createTodos`; an unused `TodoActions` type goes; both
checkboxes use `onChange`. The `todos.ts` header keeps its instruction (read
it for the layering, not the syntax), which exists because agents reading
the example missed the layering, but it is no longer phrased as a rebuke.

### `todos-server` — bottom-left, writes. RESHAPE

Today: the §9.2.3 acceptance gate — seven client-owned positions per row, an
intent record, a client error map, multi-flight `refresh`. Principles §10
places it as a widget app wearing collaborative-list clothes; it is not the
example anyone should learn from and the §9.2.3 record stays as its
history.

Target: the write side of the HTMX corner, made enviable rather than
mimicked. Server markup throughout; every mutation a compiler-claimed
`<form action={x.with(...)}>` that works without JS; **one** binding slot
with **one** position (`done`) fed by an optimistic store the action writes
before it yields; single-flight responses that morph the row back. About
ten lines of client code, no component beyond the root, instant toggles.
Failures server-rendered: a rejected action's response carries the row with
its error and a retry form. Layering moment: the optimistic toggle.

Scope line: toggle, remove, and add are optimistic. If any of them needs
more than a store write inside its action, it is not slick and it is out
(the pending-row-for-add template slot is the first candidate to fall; the
README may describe it as the increment). Bulk actions stay plain forms.
Pending feedback, if the router marks a submitting claimed form
(`aria-busy` / `data-pending`), is CSS only — see V4.

### `chat` — bottom-right FLAGSHIP. REBUILD (own plan)

Plan: `documentation/plans/chat-flagship.md` (to write first). Realistic
AI chat: threads durable and addressable; generation as a job that outlives
the request, with the thread a `live` server component projecting durable
state (close the tab, come back, caught up in one morph; two tabs agree);
real model with the fake as no-key fallback; structured message parts;
stop / regenerate / rename / delete as forms; the optimistic user bubble as
a client element in a template slot cleared by `until` on the echo; copy
button as the binding slot; native `<details>` for collapse. Failed
generations are facts about the thread — durable, server-rendered with a
retry. Absorbs `room`'s `/` page. The `usage` projection goes (token usage
is a number on the finished message), which removes the container tier's
only example — flagged, consistent with principles §10.5.

### `board` — top-right FLAGSHIP. NEW (own plan)

Plan: `documentation/plans/board-flagship.md` (to write first). Pure data
tier, no frames: one board of lists and cards as a `live` source, reconciled
by id into an optimistic nested store; moves and reorders as optimistic writes with
`until`; two tabs converging; rejected moves reverting; presence. Drag
within and between lists with pointer events, fractional ordering. Scope:
create / rename / archive, titles only, no card detail. Absorbs `room`'s
`/live` page. Acceptance bar must name the two identity moments explicitly
or they will not get built: a card sliding into its new column (same
element on both sides), and a card being edited inline while another tab
moves it — focus, caret, and draft arriving in the new column intact
(one element per card at board level, referenced from whichever list holds
it). `board` is also the top-right form of `chat`: a live thread read by
client components into an optimistic store is this architecture with a
transcript instead of lists, which is why no separate `chat-spa` exists.

### `room` — RETIRE

Stage 8's test bed. `/` becomes `chat`'s thread; `/live` becomes `board`.
The chaos switch and status pills were apparatus; connection state stays
visible in both flagships through `onstatus`, as an affordance the apps
would have anyway. Delete once both flagships exist.

### `migrating-element` — CONDITIONAL on V5

Today a canvas, because the README records that `<video>` pauses on
migration. The spec and MDN say native media survives a same-task
remove-and-reinsert; what a plain move resets is iframes, animations,
focus, popovers — the cases `moveBefore()` (Chrome 133, Firefox 144, not
Safari) exists for. If V5 finds native video retains, the example becomes
the mini-player with a `<video>` — the idiomatic case: shrink the player to
a corner while browsing the list. If `moveBefore()` is adopted in the
runtime, it becomes the mini-player with an embed and a Safari note. If
neither, it stays as is.

### `rendering`, `effect`, `sierpinski` — KEEP as is

Off-grid on purpose. `rendering` is the one kitchen sink.

## Verification items (gate the reshapes; none built)

- **V1 — Flight collector carries a result plus regions.** `notes` exercises
  redirects only. `todos-server`'s server-rendered failures and §9.6 (B)
  both need a non-redirect action result to travel with the invalidated
  regions in one response.
- **V2 — Optimistic settlement lands with the single-flight morph.** The
  overlay must drop in the same transition the response's morph applies,
  so `done` never flickers between overlay and markup (§9.2.1
  convergence).
- **V3 — `action`'s client half runs for claimed forms in frame content.**
  Compiled client markup is known to work; server-rendered
  `<form action={x.with(...)}>` inside a frame must run the action's
  generator (the optimistic write) before the server call.
- **V4 — Router pending state on a submitting claimed form.** Whether the
  router marks the form (`aria-busy` / `data-pending`) for the action's
  life. If not, a small router feature (public router behaviour —
  flagged), not an example hack.
- **V5 — Media migration.** A playing native `<video>` and a YouTube
  `<iframe>` moved through the `<Show>` migration path, Chrome and
  Firefox, with and without `moveBefore()` in place of `insertBefore` in
  the insert/reconcile path. Decides `migrating-element` and whether the
  runtime adopts `moveBefore()` behind feature detection (a runtime
  behaviour change — flagged, no API surface).

## Gaps (found by writing the examples)

Each example is written in its ideal shape first. Where that shape needs
something the framework lacks, the gap is recorded here and the example is
not done while it blocks it — no workaround in example code.

Vocabulary (settled 2026-09-29): a server component hands the client one
of two things, as Solid's compiler splits JSX into templates and bindings.
A **template slot** (`Slot<Args>`) is placed; the client fills it with
markup. A **binding slot** (`BindingSlot<Args, Bindings>`, today
`AttributeSlot`) is called for an object whose properties the server puts
at positions and never computes with. The name speaks to the server
author, where the misuse happens: `DataSlot` and `PropsSlot` both read as a
value to branch on, and a stand-in is always truthy.

- **G2 — Binding-slot execution model.** First, because the rest builds on
  it. The fill runs in a memo today (`bindDataOccurrence`), which makes a
  plain-looking body reactive and disposes state created in it on the
  first eager re-run; handlers are dispatched through a frames-own
  listener that bypasses delegation. Settled:
  - A slot is always a function; each call is an occurrence with its own
    scope, run once, untracked, with live args — as a template slot's
    fill already runs. Args are optional; the scope is why a no-args slot
    is still a function.
  - It returns an object only: plain values (static), getters (reactive),
    handlers and refs as values. Arrays, DOM nodes, functions and async
    values are excluded — the existing `fill-shape` finding, and a
    `SlotError` type constraint on `Bindings` (prototyped: a bad shape
    fails at the server's use and the client's fill with the reason in
    the message). The accessor return is deferred: getters are Solid's
    idiom for a props-like object, `createMemo` in the body covers
    "compute once, share", and a function return being an error today
    keeps adding it later non-breaking.
  - One render effect per occurrence for its value positions, as today —
    client JSX's grouping (a template's attributes share one effect); a
    getter's change re-reads the occurrence and `assign` writes only what
    changed. Text positions (G1) join that effect.
  - Handlers and refs are read once and bound through `assign` /
    `assignProp` — delegated as client JSX delegates, tuples and the
    `dispatchAsInteraction` wrap for free; the own listener goes, fan-out
    stays for merged refs only (duplicate named handlers are last-wins
    since #3704).
  - Rename `AttributeSlot` → `BindingSlot` and its diagnostic code.

  Design and decisions: `documentation/plans/binding-slot-execution.md` —
  top-level reads in either fill warn through 2.0's existing
  `STRICT_READ_UNTRACKED`; a server-side handler tuple (which loses its
  data today — reproduce first) becomes a finding, the fill returning the
  tuple instead; no `Bound<T>` type (truthiness on a stand-in stays caught
  by the rule alone). Public changes (flagged): an eager plain-object fill
  stops updating; fill state lives with the occurrence; handlers become
  delegated and are read once; the type is renamed and constrained; the
  diagnostic code is renamed; template fills gain the untracked-read
  warning. The comments in `todos-server`'s `rowFor` and `notes`'
  `searchField.ts` saying each position updates alone are corrected in
  the README pass: getters re-read with their occurrence and only changed
  positions are written. (Blocked `hackernews` until its collapse moved to
  `<details>`.)

- **G1 — Text positions.** `{t.label}` as a child: a binding-slot value at
  a text position. Today it renders nothing on either face and raises the
  "placed as TEXT" finding (principles §9.2.3, open). Design and decisions:
  `documentation/plans/text-positions.md` — a comment pair around the value
  (`<!--_s:t=occ:key-->…<!--/_s:t-->`, the t=0 value inside on the
  document face, empty on the stream face, as attributes split), found by
  the claim sweep that already tests comments; the write in G2's
  per-occurrence effect; the morph skipping owned text ranges (today it
  would reset them); primitives only, anything else a finding; raw-text
  parents (`<textarea>`, `<title>`, `<style>`, `<script>`) a documented
  rule, since the SSR compile is shared. Runtime only, no compiler change.
  **Changes documented behavior** (flagged). After G2. `todos-server`'s
  count wants it. (Blocked `hackernews` until its collapse moved to
  `<details>`.)
- **G3 — Server-only modules — resolved 2026-09-29.** The vite plugin's
  `server-only` boundary marker enforces `src/server/` (authoring layout,
  above). No framework change.

## Order

_Revised 2026-09-29, #3704 merged: least work to most, one example per
PR, and each example's exact code is proposed and reviewed before it is
written — the shape and its details are the deliverable. Server
components are unreleased, so the flagships carry no deadline; the
examples that are already right carry the most value per hour._

1. G2 (binding-slot execution), design then code.
2. G1 (text positions), design then code.
3. `hackernews` in the reviewed shape, with `hackernews-spa`'s layout
   (built 2026-09-29).
4. README and authoring-layout pass: `notes`, `todos` (and anything left
   of `hackernews-spa`).
5. `todos-server` reshape (V1–V4 first). Target decided 2026-09-29: the
   Q5 shape above — single-flight, server-rendered rejections, one
   binding slot with one position — not the Q4 wrap.
6. `chat-flagship.md`, then `chat`.
7. `board-flagship.md`, then `board`.
8. Retire `room`.
9. V5, then the `migrating-element` decision.

## Follow-ups this plan creates

- `moveBefore()` in the insert path, behind feature detection (V5).
- §9.6 (B) verification — shares V1.
- Principles §10.6 doc items: "when to reach for it" in
  `server-components.md`, the ratio note in §9.2.3.
- The comparison article: the same widget in each of the HTML-partial
  tools and here, client layer highlighted. The examples are the evidence;
  the article is the argument.
- Container tier example home, once `chat` drops `usage` (principles
  §10.5).
