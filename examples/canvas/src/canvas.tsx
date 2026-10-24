// The canvas. Everything on screen is rendered here, in the browser, from
// one value the server keeps sending: the room's shapes, the ids of its
// recent writes, and everyone's pointers.
//
// `getRoom` is a `broadcast`: one watcher on the server, its values written
// to every open tab. A tab's writes are plain server functions that answer
// nothing; what they did arrives on that stream, like everything else.
//
// There are two speeds of input. A pointer moves sixty times a second, and
// is sent as it moves — the latest position at most once a frame, and only
// when the last one has arrived — with the shape it is dragging or the
// points of the line it is drawing, if any. That is not a write: nobody
// confirms it, and a position that never lands is replaced by the next. A
// drop, or a line let go, is a write, with the same life as every other: it
// shows at once as an optimistic write to the store, is sent, and holds
// until the room's own stream carries it.
import {
  action,
  createContext,
  createMemo,
  createOptimisticStore,
  createSignal,
  For,
  latest,
  Loading,
  onSettled,
  Show,
  until,
  useContext
} from "solid-js";
import { getRequestEvent, isServer } from "@solidjs/web";
import { broadcast, live } from "@solidjs/web/server-functions";
import { IdentityContext, mintId } from "~/identity";
import { colorOf, PALETTE, SIZES } from "~/kinds";
import * as room from "~/server/room";
import type { InkSent } from "~/server/room";
import type { Drag, Identity, Kind, Presence, Room, Shape } from "~/types";

// ---------------------------------------------------------------------------
// The wire. Each of these runs on the server; in the browser the compiler
// leaves a reference to call, and `room` never reaches the bundle.

// Everyone sees the same room, so it is a broadcast: one watcher, however
// many tabs.
const getRoom = broadcast(async function* (): AsyncGenerator<Room> {
  "use server";
  yield* room.watchRoom();
});

// Being here, and this tab's seat. Joining is the connection:
// a tab is present while this response is open, and the generator's
// `finally` is what leaving means. It is the one per-viewer stream, because
// it is about the viewer: it alone carries this tab's seat token, the secret
// every write names. The document's render has no identity and only watches.
const getPresence = live(async function* (me: Identity | null): AsyncGenerator<Presence> {
  "use server";
  const joined = me ? room.join(me) : null;
  try {
    yield* room.watchSeat(joined?.entry ?? null, getRequestEvent()?.request.signal);
  } finally {
    joined?.leave();
  }
});

// What the pointer holds or draws is `null` when nothing: arguments go as
// JSON, which has no `undefined` before the last one.
async function point(
  seat: string,
  x: number,
  y: number,
  t: number,
  drag: Drag | null,
  ink: InkSent | null
) {
  "use server";
  room.point(seat, x, y, t, drag ?? undefined, ink ?? undefined);
}

async function letGo(key: string) {
  "use server";
  room.drop(key);
}

async function createStroke(seat: string, id: string, color: string, points: number[]) {
  "use server";
  room.createStroke(seat, id, color, points);
}

async function createShape(
  seat: string,
  id: string,
  kind: Kind,
  x: number,
  y: number,
  color: string
) {
  "use server";
  room.createShape(seat, id, kind, x, y, color);
}

async function moveShape(seat: string, mutation: string, id: string, x: number, y: number) {
  "use server";
  room.moveShape(seat, mutation, id, x, y);
}

async function recolorShape(seat: string, mutation: string, id: string, color: string) {
  "use server";
  room.recolorShape(seat, mutation, id, color);
}

async function writeNote(seat: string, mutation: string, id: string, text: string) {
  "use server";
  room.writeNote(seat, mutation, id, text);
}

async function deleteShape(seat: string, mutation: string, id: string) {
  "use server";
  room.deleteShape(seat, mutation, id);
}

// The host's reset, for whoever opened the page with `?admin=<key>` matching
// the server's CANVAS_ADMIN_KEY.
async function clearRoom(key: string) {
  "use server";
  room.clear(key);
}

// ---------------------------------------------------------------------------
// The room's state and its writes, for the components below.

/** How long a write waits for the room to carry it before undoing itself. */
const CONFIRM_WITHIN = 10_000;

export type Tool = "draw" | "select" | Kind;

/** The most points one position carries; a longer backlog goes over the next ones. */
const POINTS_PER_SEND = 256;
/** As room.ts's STROKE_LIMIT: drawing on past it adds nothing. */
const STROKE_LIMIT = 2000;

/** An SVG path through flat points (`x0, y0, x1, y1, …`). */
export const pathOf = (points: readonly number[]) => {
  let d = "";
  for (let i = 0; i < points.length; i += 2) d += `${i ? "L" : "M"}${points[i]} ${points[i + 1]}`;
  return d;
};

/** A stroke as it lands: placed at its top-left corner, its points from there. */
function strokeShape(id: string, color: string, points: number[]): Shape {
  const xs = points.filter((_, i) => i % 2 === 0);
  const ys = points.filter((_, i) => i % 2 === 1);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return {
    id,
    kind: "stroke",
    x,
    y,
    w: Math.max(...xs) - x,
    h: Math.max(...ys) - y,
    color,
    text: "",
    points: xs.flatMap((px, i) => [px - x, ys[i] - y])
  };
}

function createCanvas() {
  const me = useContext(IdentityContext);

  // A live source reconnects by itself and its values never show it, so
  // `onstatus` is the one place to learn that it is down.
  const [reconnecting, setReconnecting] = createSignal(false);
  const [state, setState] = createOptimisticStore<Room>(
    () => {
      const source = getRoom();
      if (!isServer) source.onstatus = status => setReconnecting(status === "reconnecting");
      return source;
    },
    { shapes: [], applied: [], pointers: [], members: [], seats: 0 }
  );
  // No identity (the document's render, and until the browser mints one) asks nothing.
  const presence = createMemo(() => {
    const m = me();
    return m ? getPresence(m) : null;
  });
  const people = () => state.members;
  /** This tab's seat token, or null while it watches (or has not heard yet). */
  const seat = () => {
    try {
      return latest(presence)?.seat ?? null;
    } catch {
      return null;
    }
  };
  /** Told there is no seat for this tab, as opposed to not told yet. */
  const watching = () => {
    try {
      return latest(presence)?.seat === null;
    } catch {
      return false;
    }
  };
  // The host's key, from the page's address. Only a key the server agrees
  // with clears anything.
  // Read once settled, like the identity, so hydration matches the server.
  const [admin, setAdmin] = createSignal<string | null>(null);
  onSettled(() => {
    if (!isServer) setAdmin(new URLSearchParams(location.search).get("admin"));
  });

  const [tool, setTool] = createSignal<Tool>("draw");
  const [color, setColor] = createSignal(PALETTE[0]);
  const [selected, setSelected] = createSignal<string | null>(null);
  const [error, setError] = createSignal<string>();

  // The shape this tab is dragging, where it has it now. Client state until
  // the drop, which is the write.
  const [held, setHeld] = createSignal<Drag | null>(null);

  // The stroke this tab is drawing: client state until it is let go, which
  // is the write. Its points are a new array per move, for the path.
  const [drawing, setDrawing] = createSignal<{
    key: string;
    color: string;
    points: number[];
  } | null>(null);

  // Everyone else's pointers, and the shapes they are dragging.
  const others = () => state.pointers.filter(p => p.id !== me()?.id);
  const dragged = createMemo(() => {
    const byShape = new Map<string, Drag>();
    for (const pointer of others()) if (pointer.drag) byShape.set(pointer.drag.id, pointer.drag);
    return byShape;
  });

  /**
   * Where a shape is drawn: where this tab holds it, else where someone
   * else does, else where the room has it. A drop clears `held` in the same
   * tick as the write it starts, which would hold the clearing until that
   * write settles; `latest` shows it now, and the optimistic write has the
   * shape in the same place.
   */
  const placeOf = (shape: Shape) => {
    const mine = latest(held);
    if (mine?.id === shape.id) return { x: mine.x, y: mine.y, remote: false };
    const theirs = dragged().get(shape.id);
    return theirs ? { x: theirs.x, y: theirs.y, remote: true } : { ...shape, remote: false };
  };

  const fail = (err: unknown) =>
    setError(
      err instanceof Error && err.name === "TimeoutError"
        ? "The room didn't confirm that, so it was undone."
        : err instanceof Error
          ? err.message
          : String(err)
    );

  // The two acknowledgements. Both read the room as the server last sent
  // it: inside an action the optimistic layer is invisible to `until`, so a
  // tab's own guess can never confirm itself.
  const applied = (mutation: string) =>
    until(() => state.applied.includes(mutation), { timeout: CONFIRM_WITHIN });
  const exists = (id: string) =>
    until(() => state.shapes.some(s => s.id === id), { timeout: CONFIRM_WITHIN });

  const edit = (id: string, change: (shape: Shape) => void) =>
    setState(r => {
      const shape = r.shapes.find(s => s.id === id);
      if (shape) change(shape);
    });

  const write = {
    create: action(function* (id: string, kind: Kind, x: number, y: number) {
      const [w, h] = SIZES[kind];
      const shape: Shape = {
        id,
        kind,
        x: Math.round(x - w / 2),
        y: Math.round(y - h / 2),
        w,
        h,
        color: color(),
        text: ""
      };
      setError(undefined);
      setState(r => void r.shapes.push(shape));
      try {
        yield createShape(seat() ?? "", id, kind, shape.x, shape.y, shape.color);
        yield exists(id);
      } catch (err) {
        fail(err);
      }
    }),

    // A stroke let go. Its key is the shape's id, so the commit that lands it
    // also ends the ink every other screen was drawing, in the same value,
    // and the row turning up confirms it.
    stroke: action(function* (id: string, color: string, points: number[]) {
      setError(undefined);
      setState(r => void r.shapes.push(strokeShape(id, color, points)));
      try {
        yield createStroke(seat() ?? "", id, color, points);
        yield exists(id);
      } catch (err) {
        fail(err);
      }
    }),

    // A drop. The drag's key is the write's mutation id, so the commit that
    // lands it also ends the drag on every other screen, in the same value.
    move: action(function* (id: string, key: string, x: number, y: number) {
      setError(undefined);
      setState(r => {
        const index = r.shapes.findIndex(s => s.id === id);
        if (index < 0) return;
        const [shape] = r.shapes.splice(index, 1);
        r.shapes.push({ ...shape, x, y });
      });
      try {
        yield moveShape(seat() ?? "", key, id, x, y);
        yield applied(key);
      } catch (err) {
        fail(err);
      }
    }),

    recolor: action(function* (id: string, next: string) {
      const mutation = mintId();
      setError(undefined);
      edit(id, shape => void (shape.color = next));
      try {
        yield recolorShape(seat() ?? "", mutation, id, next);
        yield applied(mutation);
      } catch (err) {
        fail(err);
      }
    }),

    note: action(function* (id: string, text: string) {
      const mutation = mintId();
      setError(undefined);
      edit(id, shape => void (shape.text = text));
      try {
        yield writeNote(seat() ?? "", mutation, id, text);
        yield applied(mutation);
      } catch (err) {
        fail(err);
      }
    }),

    remove: action(function* (id: string) {
      const mutation = mintId();
      setError(undefined);
      setState(r => void (r.shapes = r.shapes.filter(s => s.id !== id)));
      try {
        yield deleteShape(seat() ?? "", mutation, id);
        yield applied(mutation);
      } catch (err) {
        fail(err);
      }
    })
  };

  // ---- the pointer, sent as it moves ----
  //
  // The latest position, at most once a frame, and not while the last one is
  // still on its way. Positions in between are dropped, not queued, so a slow
  // server or a long round trip means fewer, larger steps rather than a
  // growing lag; other tabs smooth the steps (see `.remote` in app.css).
  let svg: SVGSVGElement | undefined;
  let pointer: { x: number; y: number } | undefined;
  let frame = 0;
  let sending = false;
  // How many points of the stroke being drawn have reached the server.
  let landed = { key: "", count: 0 };
  const send = async () => {
    frame = 0;
    const mine = seat();
    if (!pointer || !mine || sending) return;
    const { x, y } = pointer;
    pointer = undefined;
    sending = true;
    const stroke = latest(drawing);
    let ink: InkSent | null = null;
    if (stroke) {
      if (landed.key !== stroke.key) landed = { key: stroke.key, count: 0 };
      const points = stroke.points.slice(landed.count * 2, (landed.count + POINTS_PER_SEND) * 2);
      ink = { key: stroke.key, color: stroke.color, from: landed.count, points };
      // More than one send's worth waiting: come back next frame for the rest.
      if (stroke.points.length > (landed.count + POINTS_PER_SEND) * 2) pointer = { x, y };
    }
    try {
      await point(mine, x, y, Date.now(), latest(held), ink);
      if (ink && landed.key === ink.key) landed.count = ink.from + ink.points.length / 2;
    } catch {
      // A lost position is replaced by the next one, and a lost piece of a
      // stroke is sent again with it: `landed` did not move.
    } finally {
      sending = false;
      if (pointer && !frame) frame = requestAnimationFrame(send);
    }
  };
  const at = (e: PointerEvent) => {
    const box = svg!.getBoundingClientRect();
    return { x: Math.round(e.clientX - box.left), y: Math.round(e.clientY - box.top) };
  };
  const track = (e: PointerEvent) => {
    if (!svg) return;
    pointer = at(e);
    if (!frame && !sending) frame = requestAnimationFrame(send);
  };

  // ---- dragging a shape ----

  /** How far the pointer travels before a press becomes a drag and not a click. */
  const SLOP = 4;

  const grab = (shape: Shape, e: PointerEvent) => {
    if (tool() !== "select" || e.button !== 0 || !seat()) return;
    e.stopPropagation();
    setSelected(shape.id);
    const start = at(e);
    const from = placeOf(shape);
    const key = mintId();
    let drag: Drag | undefined;

    const move = (e: PointerEvent) => {
      const now = at(e);
      if (!drag && Math.hypot(now.x - start.x, now.y - start.y) < SLOP) return;
      drag = { id: shape.id, key, x: from.x + now.x - start.x, y: from.y + now.y - start.y };
      setHeld(drag);
      track(e);
    };
    const finish = (drop: boolean) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", escape, true);
      if (!drag) return; // a click: selecting was all it did
      setHeld(null);
      if (drop) write.move(shape.id, key, drag.x, drag.y);
      else {
        letGo(key).catch(() => {});
      }
    };
    const up = () => finish(true);
    const cancel = () => finish(false);
    const escape = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !drag) return;
      e.preventDefault();
      e.stopPropagation();
      finish(false);
    };
    // On the window: a fast pointer is off the shape before the first move.
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", escape, true);
  };

  // ---- drawing a stroke ----

  const draw = (e: PointerEvent) => {
    const key = mintId();
    const start = at(e);
    let points = [start.x, start.y];
    setDrawing({ key, color: color(), points });
    track(e);

    const move = (e: PointerEvent) => {
      const { x, y } = at(e);
      const n = points.length;
      if (n >= STROKE_LIMIT * 2) return track(e);
      // Closer than this to the last point adds nothing you can see.
      if (Math.hypot(x - points[n - 2], y - points[n - 1]) < 2) return;
      points = [...points, x, y];
      setDrawing({ key, color: color(), points });
      track(e);
    };
    const finish = (keep: boolean) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", escape, true);
      setDrawing(null);
      if (keep && points.length >= 4) write.stroke(key, color(), points);
      else letGo(key).catch(() => {});
    };
    const up = () => finish(true);
    const cancel = () => finish(false);
    const escape = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      finish(false);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", escape, true);
  };

  /**
   * A press on the canvas itself (or, when drawing, anywhere on it): draws,
   * places a shape, or clears the selection.
   */
  const press = (e: PointerEvent) => {
    if (e.button !== 0 || !seat()) return;
    const kind = tool();
    if (kind === "draw") return draw(e);
    if (kind === "select") return setSelected(null);
    const { x, y } = at(e);
    const id = mintId();
    write.create(id, kind, x, y);
    setTool("select");
    setSelected(id);
  };

  return {
    state,
    drawing: () => latest(drawing),
    me,
    people,
    seat,
    watching,
    admin,
    clear: () =>
      clearRoom(admin() ?? "").then(
        () => setError(undefined),
        err => fail(err)
      ),
    others,
    reconnecting,
    error,
    tool,
    setTool,
    color,
    setColor,
    selected,
    setSelected,
    placeOf,
    write,
    grab,
    press,
    track,
    setSvg: (el: SVGSVGElement) => void (svg = el)
  };
}

const CanvasContext = createContext<ReturnType<typeof createCanvas>>();

// ---------------------------------------------------------------------------
// The screen.

export default function CanvasScreen() {
  return (
    <CanvasContext value={createCanvas()}>
      <CanvasView />
    </CanvasContext>
  );
}

const TOOLS: [Tool, string][] = [
  ["draw", "Draw"],
  ["select", "Select"],
  ["rect", "Rectangle"],
  ["ellipse", "Ellipse"],
  ["note", "Note"]
];

function CanvasView() {
  const canvas = useContext(CanvasContext);
  const { state, me, people, others, reconnecting, error, tool, setTool, color, setColor } = canvas;
  const { selected, write, press, track, setSvg, drawing, watching, admin } = canvas;

  // Delete or Backspace removes the selected shape, unless a field has the keys.
  const onKeyDown = (e: KeyboardEvent) => {
    const id = selected();
    if (!id || (e.key !== "Delete" && e.key !== "Backspace")) return;
    if ((e.target as Element).closest("textarea, input")) return;
    e.preventDefault();
    canvas.setSelected(null);
    write.remove(id);
  };

  return (
    <div class={["canvas", { watching: watching() }]} tabindex="-1" onKeyDown={onKeyDown}>
      <header class="toolbar">
        <div class="tools" role="toolbar" aria-label="Tools">
          <For each={TOOLS}>
            {([name, label]) => (
              <button
                type="button"
                class={{ on: tool() === name }}
                aria-pressed={tool() === name ? "true" : "false"}
                onClick={() => setTool(name)}
              >
                {label}
              </button>
            )}
          </For>
        </div>
        <div class="palette" role="toolbar" aria-label="Colour">
          <For each={PALETTE}>
            {swatch => (
              <button
                type="button"
                class={{ on: color() === swatch }}
                style={{ background: swatch }}
                aria-label={`Colour ${swatch}`}
                onClick={() => {
                  setColor(swatch);
                  const id = selected();
                  if (id) write.recolor(id, swatch);
                }}
              />
            )}
          </For>
        </div>
        <Show when={error()}>
          {message => (
            <p class="error" role="alert">
              {message()}
            </p>
          )}
        </Show>
        <Show when={reconnecting()}>
          <p class="wire" role="status">
            Reconnecting…
          </p>
        </Show>
        <Show when={admin()}>
          <button type="button" class="clear" onClick={() => canvas.clear()}>
            Clear the room
          </button>
        </Show>
        <Loading>
          <Show when={watching()}>
            <p class="wire" role="status">
              Watching: all {state.seats} seats are taken. You get one when someone leaves.
            </p>
          </Show>
          <ul class="people" aria-label="Here now">
            <For each={people().filter(person => person.seated)}>
              {person => (
                <li
                  class={{ me: person.id === me()?.id }}
                  style={{ background: colorOf(person.id) }}
                  title={person.name}
                >
                  {initials(person.name)}
                </li>
              )}
            </For>
            <Show when={people().filter(person => !person.seated).length}>
              {count => <li class="watching">+{count()}</li>}
            </Show>
          </ul>
        </Loading>
      </header>
      <Loading fallback={<p class="loading">Loading the room…</p>}>
        <svg
          class={["surface", { drawing: tool() !== "select" }]}
          ref={setSvg}
          onPointerDown={press}
          onPointerMove={track}
        >
          <For each={state.shapes}>{shape => <ShapeView shape={shape} />}</For>
          {/* Strokes being drawn: everyone else's as far as the server has
              them, then this tab's own, as it draws. */}
          <For each={others()}>
            {pointer => (
              <Show when={pointer.ink}>
                {ink => <path class="ink" d={pathOf(ink().chunks.flat())} stroke={ink().color} />}
              </Show>
            )}
          </For>
          <Show when={drawing()}>
            {stroke => <path class="ink" d={pathOf(stroke().points)} stroke={stroke().color} />}
          </Show>
          <For each={others()}>
            {pointer => (
              <g
                class="cursor remote"
                style={{ transform: `translate(${pointer.x}px, ${pointer.y}px)` }}
                aria-hidden="true"
              >
                <path
                  d="M0 0 L0 16 L4.5 12 L8 19 L10.5 18 L7 11 L13 11 Z"
                  fill={colorOf(pointer.id)}
                />
                <text x="14" y="24" fill={colorOf(pointer.id)}>
                  {pointer.name}
                </text>
              </g>
            )}
          </For>
        </svg>
      </Loading>
    </div>
  );
}

// "quick-otter" → "QO"
const initials = (name: string) =>
  name
    .split("-")
    .map(part => part[0]?.toUpperCase())
    .join("");

function ShapeView(props: { shape: Shape }) {
  const { selected, placeOf, grab, write } = useContext(CanvasContext);
  const place = () => placeOf(props.shape);
  const [writing, setWriting] = createSignal(false);
  return (
    <g
      class={[
        "shape",
        `is-${props.shape.kind}`,
        { selected: selected() === props.shape.id, remote: place().remote }
      ]}
      style={{ transform: `translate(${place().x}px, ${place().y}px)` }}
      data-shape={props.shape.id}
      onPointerDown={e => grab(props.shape, e)}
      onDblClick={() => props.shape.kind === "note" && setWriting(true)}
    >
      {props.shape.kind === "stroke" ? (
        <>
          {/* Wide and invisible, so a thin line is easy to grab. */}
          <path class="hit" d={pathOf(props.shape.points ?? [])} />
          <path class="line" d={pathOf(props.shape.points ?? [])} stroke={props.shape.color} />
        </>
      ) : props.shape.kind === "ellipse" ? (
        <ellipse
          cx={props.shape.w / 2}
          cy={props.shape.h / 2}
          rx={props.shape.w / 2}
          ry={props.shape.h / 2}
          fill={props.shape.color}
        />
      ) : (
        <rect
          width={props.shape.w}
          height={props.shape.h}
          rx={props.shape.kind === "note" ? 2 : 8}
          fill={props.shape.color}
        />
      )}
      <Show when={props.shape.kind === "note"}>
        <foreignObject width={props.shape.w} height={props.shape.h}>
          <Show when={writing()} fallback={<p class="note">{props.shape.text}</p>}>
            <NoteEditor
              value={props.shape.text}
              onDone={text => {
                setWriting(false);
                if (text !== undefined && text !== props.shape.text)
                  write.note(props.shape.id, text);
              }}
            />
          </Show>
        </foreignObject>
      </Show>
    </g>
  );
}

// A note's words, being written. Enter or leaving the field commits,
// Shift+Enter is a new line, Escape abandons.
function NoteEditor(props: { value: string; onDone: (text?: string) => void }) {
  let done = false;
  const finish = (text?: string) => {
    if (done) return;
    done = true;
    props.onDone(text);
  };
  return (
    <textarea
      class="note"
      aria-label="Note"
      maxlength="280"
      value={props.value}
      ref={el =>
        queueMicrotask(() => {
          el.focus();
          el.select();
        })
      }
      onPointerDown={e => e.stopPropagation()}
      onKeyDown={e => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          finish(e.currentTarget.value.trim());
        } else if (e.key === "Escape") finish();
      }}
      onBlur={e => finish(e.currentTarget.value.trim())}
    />
  );
}
