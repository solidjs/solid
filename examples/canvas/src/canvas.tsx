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
// when the last one has arrived — with the shape it is dragging, if any.
// That is not a write: nobody confirms it, and a position that never lands
// is replaced by the next. A drop is a write, with the same life as every
// other: it shows at once as an optimistic write to the store, is sent, and
// holds until the room's own stream carries it.
import {
  action,
  createContext,
  createMemo,
  createOptimisticStore,
  createSignal,
  For,
  latest,
  Loading,
  Show,
  until,
  useContext
} from "solid-js";
import { getRequestEvent, isServer } from "@solidjs/web";
import { broadcast, live } from "@solidjs/web/server-functions";
import { IdentityContext, mintId } from "~/identity";
import { colorOf, PALETTE, SIZES } from "~/kinds";
import * as room from "~/server/room";
import type { Drag, Identity, Kind, Member, Room, Shape } from "~/types";

// ---------------------------------------------------------------------------
// The wire. Each of these runs on the server; in the browser the compiler
// leaves a reference to call, and `room` never reaches the bundle.

// Everyone sees the same room, so it is a broadcast: one watcher, however
// many tabs.
const getRoom = broadcast(async function* (): AsyncGenerator<Room> {
  "use server";
  yield* room.watchRoom();
});

// Who is here. Joining is the connection: a tab is present while this
// response is open, and the generator's `finally` is what leaving means. It
// is the one per-viewer stream, because it is about the viewer. The
// document's render has no identity and only watches.
const getPresence = live(async function* (me: Identity | null): AsyncGenerator<Member[]> {
  "use server";
  const leave = me ? room.join(me) : () => {};
  try {
    yield* room.watchMembers(getRequestEvent()?.request.signal);
  } finally {
    leave();
  }
});

async function point(id: string, x: number, y: number, t: number, drag?: Drag) {
  "use server";
  room.point(id, x, y, t, drag);
}

async function dropShape(id: string, key: string) {
  "use server";
  room.drop(id, key);
}

async function createShape(id: string, kind: Kind, x: number, y: number, color: string) {
  "use server";
  room.createShape(id, kind, x, y, color);
}

async function moveShape(mutation: string, id: string, x: number, y: number) {
  "use server";
  room.moveShape(mutation, id, x, y);
}

async function recolorShape(mutation: string, id: string, color: string) {
  "use server";
  room.recolorShape(mutation, id, color);
}

async function writeNote(mutation: string, id: string, text: string) {
  "use server";
  room.writeNote(mutation, id, text);
}

async function deleteShape(mutation: string, id: string) {
  "use server";
  room.deleteShape(mutation, id);
}

// ---------------------------------------------------------------------------
// The room's state and its writes, for the components below.

/** How long a write waits for the room to carry it before undoing itself. */
const CONFIRM_WITHIN = 10_000;

export type Tool = "select" | Kind;

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
    { shapes: [], applied: [], pointers: [] }
  );
  const people = createMemo(() => getPresence(me()));

  const [tool, setTool] = createSignal<Tool>("select");
  const [color, setColor] = createSignal(PALETTE[0]);
  const [selected, setSelected] = createSignal<string | null>(null);
  const [error, setError] = createSignal<string>();

  // The shape this tab is dragging, where it has it now. Client state until
  // the drop, which is the write.
  const [held, setHeld] = createSignal<Drag | null>(null);

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
        yield createShape(id, kind, shape.x, shape.y, shape.color);
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
        yield moveShape(key, id, x, y);
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
        yield recolorShape(mutation, id, next);
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
        yield writeNote(mutation, id, text);
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
        yield deleteShape(mutation, id);
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
  const send = async () => {
    frame = 0;
    const id = me()?.id;
    if (!pointer || !id || sending) return;
    const { x, y } = pointer;
    pointer = undefined;
    sending = true;
    try {
      await point(id, x, y, Date.now(), latest(held) ?? undefined);
    } catch {
      // A lost position is replaced by the next one.
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
    if (tool() !== "select" || e.button !== 0) return;
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
        const id = me()?.id;
        if (id) dropShape(id, key).catch(() => {});
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

  /** A press on the canvas itself: places a shape with a drawing tool, else clears the selection. */
  const press = (e: PointerEvent) => {
    if (e.button !== 0) return;
    const kind = tool();
    if (kind === "select") return setSelected(null);
    const { x, y } = at(e);
    const id = mintId();
    write.create(id, kind, x, y);
    setTool("select");
    setSelected(id);
  };

  return {
    state,
    me,
    people,
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
  ["select", "Select"],
  ["rect", "Rectangle"],
  ["ellipse", "Ellipse"],
  ["note", "Note"]
];

function CanvasView() {
  const canvas = useContext(CanvasContext);
  const { state, me, people, others, reconnecting, error, tool, setTool, color, setColor } = canvas;
  const { selected, write, press, track, setSvg } = canvas;

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
    <div class="canvas" tabindex="-1" onKeyDown={onKeyDown}>
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
        <ul class="people" aria-label="Here now">
          <Loading>
            <For each={people()}>
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
          </Loading>
        </ul>
      </header>
      <Loading fallback={<p class="loading">Loading the room…</p>}>
        <svg
          class={["surface", { drawing: tool() !== "select" }]}
          ref={setSvg}
          onPointerDown={press}
          onPointerMove={track}
        >
          <For each={state.shapes}>{shape => <ShapeView shape={shape} />}</For>
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
      class={["shape", { selected: selected() === props.shape.id, remote: place().remote }]}
      style={{ transform: `translate(${place().x}px, ${place().y}px)` }}
      data-shape={props.shape.id}
      onPointerDown={e => grab(props.shape, e)}
      onDblClick={() => props.shape.kind === "note" && setWriting(true)}
    >
      {props.shape.kind === "ellipse" ? (
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
