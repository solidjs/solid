# Canvas — multiplayer over one broadcast

A shared canvas that several people draw on at once. A line appears on
everyone's screen as it is drawn, everyone's pointer is on everyone's
screen, and there are rectangles, ellipses and notes to place and drag
around, moving on every screen while they are dragged. No sockets. The server
sends one value to every tab, and a tab writes with plain server functions.

It sits next to [../board](../board), which has the same optimistic writes
over a per-viewer `live` stream. Here the stream is a `broadcast` and the
input runs at pointer rate.

```sh
pnpm dev                       # https://localhost:3014/  (self-signed cert)
HTTPS=0 pnpm dev               # http://localhost:3014/
pnpm build && pnpm start       # production harness, http://localhost:3014/
pnpm check                     # server checks, build, client-bundle check
```

Open it in **two tabs** (or two browsers). Each tab is its own person.

## What to look at

- **Drawing.** Draw in one tab (Draw is the starting tool): the other tab
  sees the line grow as you draw it, not appear when you let go. When you
  let go nothing flickers: the line being drawn becomes the finished one in
  the same frame, on both screens. Escape abandons a line.
- **Pointers.** Move the mouse in one tab; its pointer moves in the other,
  with the tab's name on it.
- **A drag is seen while it happens.** Drag a shape: the other tab sees it
  move under your pointer, not jump when you let go.
- **A drop never jumps back.** When you let go, the other tab's copy stays
  where it is and the shape stays put in yours. The drop is a write, but
  nothing on either screen waits for it.
- **A refusal goes back.** Grab a shape in one tab, delete it in the other
  (select, then Delete), and drop it. The drop is refused and the tab says
  why.
- **Leaving.** Close a tab in the middle of a drag: in the other tab the
  shape goes back to where it was, and the pointer goes. In the middle of a
  line, the unfinished line goes.
- **Create, colour, words.** Pick Rectangle, Ellipse or Note and click to
  place one. With Select, a finished line is a shape too: drag it, delete
  it. With a shape selected, a colour swatch recolours it.
  Double-click a note to write in it.

## One value for everyone

[src/canvas.tsx](./src/canvas.tsx) is the whole screen.
[src/server/room.ts](./src/server/room.ts) is the room and its rules.

```tsx
const getRoom = broadcast(async function* (): AsyncGenerator<Room> {
  "use server";
  yield* room.watchRoom();
});

const [state, setState] = createOptimisticStore<Room>(() => getRoom(), …);
```

The room is one value: the shapes, the ids of recent writes (`applied`),
and every pointer, each with the shape it is dragging or the line it is
drawing, if any. Every tab
gets the same value, so it is a `broadcast`: one watcher on the server, its
records written to every open tab. A shape or a pointer that did not change
is the same object as in the value before, so it crosses as a reference.

`watchRoom` yields at most once per frame (16 ms), with the latest of
everything. Positions that land between two values are skipped, never
queued. This is required, not a tuning: with one value per pointer write,
ten people moving at once already put seconds of lag on every screen,
because a stream that can't keep up only grows (`CANVAS_FRAME_MS=0` turns
it off, to see that).

Who is here is the one per-viewer stream, `getPresence`, as on the board: a
tab is present while its response is open, and the generator's `finally` is
what leaving means. It is about the viewer, so it can't be shared.

## Two speeds of input

**A pointer is not a write.** It moves sixty times a second. A tab sends
its latest position at most once a frame, and only once the previous one
has arrived:

```tsx
await point(id, x, y, Date.now(), latest(held), ink);
```

Nothing confirms it and nothing undoes it: a position that never lands is
replaced by the next one. A slow server or a long round trip means fewer,
larger steps rather than a growing lag. Other tabs ease each step over
80 ms (`.remote` in [app.css](./src/app.css)), so the steps read as motion.
A tab's own pointer and drag are never eased.

While a tab drags a shape, its position carries the drag: the shape, where
it is now, and the drag's key. The room keeps that on the tab's pointer
until the drag ends, and every tab draws the shape there.

While a tab draws, its position carries the points added since the last
position that landed (`ink`). The room keeps the line on the tab's pointer
in chunks of 32 points: only the last chunk grows, and a full one never
changes, so each value sends the last chunk and refers to the full ones. A
long line costs a viewer at most a chunk of points per frame, not the whole
line again. (A chunk per frame looks cheaper but is not: every value then
refers to every chunk so far, and a two-second line cost more each frame
until 25 people drawing saturated the server.) A lost position is not a
lost piece of the line: the tab counts what landed, and the next position
starts from there.

**A drop is a write**, with the same life as the board's:

```tsx
move: action(function* (id, key, x, y) {
  setState(r => {
    /* the shape, at x/y, on top */
  });
  yield moveShape(key, id, x, y);
  yield applied(key);
});
```

It shows at once as an optimistic write, is sent, and holds until the
room's own value carries its id. The drag's key is the write's mutation id,
and `moveShape` lands the move and ends that drag in the same commit, so
they arrive in the same value. No tab ever sees the shape back where it
started between the end of the drag and the move. A position for that drag
that arrives after the move only moves the pointer.

**A finished line is a create.** Its key, minted when the line started, is
the new shape's id, so `createStroke` lands the shape and takes the
unfinished line off the tab's pointer in the same commit. Every other tab
sees one value with the line drawn, then the next with it finished, never
one with neither. The row turning up is the confirmation, as for any shape.

## Cost

Measured on one Node process (`pnpm start`) on a 4-core container, with
Node clients on the same machine. Each client acts as a tab: presence and
the room's broadcast open, and a pointer moving every frame, sent the way
canvas.tsx sends it. Everyone moves at once, which a real room rarely does.
Two rounds; ranges are across them. Pointing (and dragging a shape, which
measured the same):

| people moving | server CPU, ms/s | positions sent per person (of 60/s) | pointer latency p50 / p95 |
| ------------- | ---------------- | ----------------------------------- | ------------------------- |
| 1             | 144-212          | 60                                  | 8-9 / 17-21 ms            |
| 10            | 506-617          | 60-61                               | 11-12 / 19-25 ms          |
| 25            | 924-948          | 59-61                               | 15-17 / 26-37 ms          |
| 50            | 1349-1497        | 32-45                               | 28-50 / 55-240 ms         |
| 75            | 1510-1651        | 20-27                               | 47-75 / 115-932 ms        |

Up to about 25 people moving at once, every position gets through and the
other screens are a frame or two behind. At 50 it is at its edge: most
positions still arrive, and how late varies run to run. Past that, people
send fewer, larger steps (the easing hides some of it) rather than falling
behind. Latency is measured from the sending tab's clock to the viewer's
receipt, on one machine, so it has no network in it; over a real network
each person also sends at most one position per round trip.

Everyone drawing at once (each client draws a two-second line, lets it go
and starts the next), latency measured to the points showing up on other
screens:

| people drawing | server CPU, ms/s | positions sent per person (of 60/s) | latency p50 / p95   | sent to each viewer |
| -------------- | ---------------- | ----------------------------------- | ------------------- | ------------------- |
| 1              | 157-159          | 62                                  | 9 / 17-18 ms        | 5 kB/s              |
| 10             | 565-599          | 62                                  | 12 / 21 ms          | 27-28 kB/s          |
| 25             | 1143-1159        | 60                                  | 19 / 32-34 ms       | 63-65 kB/s          |
| 50             | 1832             | 20-22                               | 97-329 / 376-567 ms | 165-175 kB/s        |

Drawing costs more than pointing, because every value carries everyone's
unfinished line: up to 25 people drawing at once is smooth, and 50 is past
the edge on one process.

What runs out first is the cost of each POST, not sending the value to
everyone. Most of a POST's server time is turning Node's request into a
fetch `Request` and its answer back, not the server-function runtime.

## Notes

- **HTTP/2.** A tab holds two live connections and sends a POST per frame.
  Browsers allow six connections per origin over HTTP/1.1, so a second tab
  in the same browser stalls; `pnpm dev` serves HTTPS, which Vite speaks as
  HTTP/2. Deploy it on HTTP/2 too.
- **Memory only.** The room resets with the server.
- **No pan, zoom or resize.** The canvas is the window.
- **Touch dragging** uses the same pointer events but has not been checked
  on a device.
- **Idle teardown.** After the last tab leaves, the room's watcher returns
  at its next step, so with nobody writing it waits for the next change.
