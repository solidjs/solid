# Examples Plan — one idiomatic app per grid coordinate

_Drafted 2026-09-28, from the fit conversation that produced principles §10
and §9.6, with Stages 1–8 built and #3704 (attribute slots, second form)
the last heavy feature. Status: DIRECTION AGREED in conversation; nothing
here is built. This page is the checklist for the example set as a whole;
the two flagships get their own plans (linked below) and this page does not
design them. Design record: `documentation/server-components/
server-components-principles.md` §10 (fit) and §9.6 (live mutations seed).
The grid is the one in "The Grand Unifying Architecture of Frontend"
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
`onClick={block.onCopy}` on the server). No example may need a fill to be
more than an object literal; where one does, that is a §9.2.3 ergonomics
finding to raise, not something example code hides.

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

### `hackernews` — bottom-left, reads. KEEP; one binding change + README

The front door: the simplest server component, navigation over server
markup, a single stateful client concern. Its layering moment is comment
collapse — client state on server-rendered elements deep in a tree, surviving
navigation. Today that is a `Toggle` client component wrapping a markup slot
(`toggle={p => <Toggle>{p.children}</Toggle>}`); under §9.2.3's placement
principle a thread exists because the server has comments, so it is server
markup and the collapse is an attribute slot (`class` and `onClick` bound on
the server's own elements). Convert it; it is the idiomatic form and the
example gets smaller. README repositioned to the coordinate and twin.

### `hackernews-spa` — top-left. KEEP as is

The twin; exists only as the comparison. README names the coordinate.

### `notes` — middle-left, the RSC coordinate. KEEP; README only

React's own server-components demo ported: client islands whose state
survives server updates around them, single-flight mutations by redirect,
the search field as the idiomatic attribute slot. Its layering moment is the
editor keeping its draft while the sidebar list refreshes around it — the
"shared client state preserved" line the HTML-partial tools cannot cross.
Code unchanged; README repositioned. The overlap with `chat` (both are
sidebar + viewer + mutations) is intentional: opposite sides of the grid,
different audience.

### `todos` — top-left. KEEP as is

The SPA control: optimistic store over `refresh`, client-held API mock.
Twin of `todos-server`; also the pedagogical control for `board`.

### `todos-server` — bottom-left, writes. RESHAPE

Today: the §9.2.3 acceptance gate — seven client-owned positions per row, an
intent record, a client error map, multi-flight `refresh`. Principles §10
places it as a widget app wearing collaborative-list clothes; it is not the
example anyone should learn from and the §9.2.3 record stays as its
history.

Target: the write side of the HTMX corner, made enviable rather than
mimicked. Server markup throughout; every mutation a compiler-claimed
`<form action={x.with(...)}>` that works without JS; **one** attribute slot
with **one** position (`done`) fed by an optimistic store the action writes
before it yields; single-flight responses that morph the row back. About
ten lines of client code, no component beyond the root, instant toggles.
Failures server-rendered: a rejected action's response carries the row with
its error and a retry form. Layering moment: the optimistic toggle.

Scope line: toggle, remove, and add are optimistic. If any of them needs
more than a store write inside its action, it is not slick and it is out
(the pending-row-for-add markup slot is the first candidate to fall; the
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
a client element in a markup slot cleared by `until` on the echo; copy
button as the attribute slot; native `<details>` for collapse. Failed
generations are facts about the thread — durable, server-rendered with a
retry. Absorbs `room`'s `/` page. The `usage` projection goes (token usage
is a number on the finished message), which removes the container tier's
only example — flagged, consistent with principles §10.5.

### `board` — top-right FLAGSHIP. NEW (own plan)

Plan: `documentation/plans/board-flagship.md`. Pure data tier, no frames:
one board of lists and cards as a `live` source, reconciled by id into an
optimistic nested store; moves and reorders as optimistic writes with
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
  life. If not, a small router feature, not an example hack.
- **V5 — Media migration.** A playing native `<video>` and a YouTube
  `<iframe>` moved through the `<Show>` migration path, Chrome and
  Firefox, with and without `moveBefore()` in place of `insertBefore` in
  the insert/reconcile path. Decides `migrating-element` and whether the
  runtime adopts `moveBefore()` behind feature detection (a runtime
  behaviour change — flagged, no API surface).

## Order

_Revised 2026-09-29, #3704 merged: least work to most, one example per
PR, and each example's exact code is proposed and reviewed before it is
written — the shape and its details are the deliverable. Server
components are unreleased, so the flagships carry no deadline; the
examples that are already right carry the most value per hour._

1. README pass on the examples that are right today: `notes`,
   `hackernews-spa`, `todos` (README only); `hackernews` (the `Toggle` →
   attribute slot change, then README).
2. `todos-server` reshape (V1–V4 first). Target decided 2026-09-29: the
   Q5 shape above — single-flight, server-rendered rejections, one
   attribute slot with one position — not the Q4 wrap.
3. `chat-flagship.md`, then `chat`.
4. `board-flagship.md`, then `board`.
5. Retire `room`.
6. V5, then the `migrating-element` decision.

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
