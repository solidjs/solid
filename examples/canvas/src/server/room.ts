import "server-only";
// The room: its shapes (finished lines among them), who is here, where
// their pointers are, and the lines they are drawing. The only place its
// rules live. Only `"use server"` bodies import this module; the marker
// above fails the build if it ever reaches a client bundle.
//
// Everything is memory and resets with the server. Shapes are the room's
// state; members and pointers belong to open connections and are fine to
// lose, since a reconnect rebuilds them by joining again.
//
// Everyone watches one value, `watchRoom`: the shapes, the ids of recent
// writes, every pointer, and who is here. A write is answered by the next value, not by
// its response. Because pointers ride in the same value as the shapes, a
// drag or a line that ends and the write that ends it arrive together:
// nobody sees a shape go back to where it was before landing where it was
// dropped, or a line vanish before it lands.
import { randomUUID } from "node:crypto";
import { SIZES } from "~/kinds";
import type { Drag, Identity, Ink, Kind, Member, Pointer, Presence, Room, Shape } from "~/types";

/** The room holds at most this many shapes. Checked here and nowhere else. */
export const SHAPE_LIMIT = 200;
/** The canvas is this big; positions outside it are pulled in. */
export const SIZE = 4000;

/**
 * How many recent write ids the room remembers, from everyone. A write is
 * confirmed when its id shows up in a value, so this only has to outlast the
 * writes that can land between two values a viewer reads.
 */
const APPLIED_KEPT = 64;

// Values are sent at most this often, carrying the latest of everything:
// pointer positions that land between two sends are skipped, never queued.
// Without this a viewer would be sent one value per pointer write, and a
// stream that can't keep up only grows. CANVAS_FRAME_MS=0 turns it off.
const FRAME_MS = Number(process.env.CANVAS_FRAME_MS ?? 16);

const shapes: Shape[] = [
  { id: "seedrect1", kind: "rect", x: 120, y: 140, w: 180, h: 110, color: "#579dff", text: "" },
  { id: "seedcirc1", kind: "ellipse", x: 380, y: 200, w: 140, h: 140, color: "#f87168", text: "" },
  {
    id: "seednote1",
    kind: "note",
    x: 600,
    y: 120,
    w: 200,
    h: 130,
    color: "#e2b203",
    text: "Open this page in a second tab and drag me"
  }
];
let applied: string[] = [];
/** A member's place in the room. `seat` is its secret: only its own presence stream carries it. */
interface Entry extends Member {
  seat: string | null;
}
const members = new Map<string, Entry>();
/**
 * Who is here as everyone is told it: rebuilt on a join, a leave or a seat
 * changing hands, and otherwise the same array and the same objects, so a
 * value sends it as a reference.
 */
let roster: Member[] = [];
const pointers = new Map<string, Pointer>();
/** Drags whose move has landed (or that were dropped): late positions for them are ignored. */
const ended = new Set<string>();

// ---------------------------------------------------------------------------
// Change notification: a counter and the promises parked on its next
// increment.

let version = 0;
const waiters = new Set<() => void>();

function changed(signal?: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    const wake = () => {
      waiters.delete(wake);
      signal?.removeEventListener("abort", wake);
      resolve();
    };
    waiters.add(wake);
    signal?.addEventListener("abort", wake, { once: true });
  });
}

function notify() {
  version++;
  const waking = [...waiters];
  waiters.clear();
  for (const wake of waking) wake();
}

/**
 * The room now and after every change, at most once per frame; ends when
 * `signal` aborts. Every yield is the whole room, so a reconnect starts from
 * one yield. It is the same for everyone who watches. Shapes and pointers
 * that did not change are the same objects as in the yield before, so they
 * cross as references.
 */
export async function* watchRoom(signal?: AbortSignal): AsyncGenerator<Room> {
  let seen = -1;
  while (!signal?.aborted) {
    if (version !== seen) {
      seen = version;
      yield {
        shapes: [...shapes],
        applied,
        pointers: [...pointers.values()],
        members: roster,
        seats: SEATS
      };
      if (FRAME_MS > 0) await new Promise(resolve => setTimeout(resolve, FRAME_MS));
      // A change can land while the consumer holds this value: look again
      // before waiting.
      continue;
    }
    await changed(signal);
  }
}

// ---------------------------------------------------------------------------
// Presence, and seats.
//
// Anyone can watch; only the first SEATS people in the room can point, draw
// and write. Each seated member holds a seat token, a secret sent only on its
// own presence stream (never on the room's broadcast, where every member's id
// is public), and every write names it. When a seat frees, whoever has been
// watching longest takes it.

/** How many people can point, draw and write at once. CANVAS_SEATS=<n> changes it. */
export const SEATS = Number(process.env.CANVAS_SEATS || 20);

// Gives free seats to whoever has waited longest, and rebuilds the roster.
function seatEveryone() {
  let taken = 0;
  for (const entry of members.values()) if (entry.seat) taken++;
  for (const entry of [...members.values()].sort((a, b) => a.since - b.since)) {
    if (taken >= SEATS) break;
    if (entry.seat) continue;
    entry.seat = randomUUID().replaceAll("-", "");
    entry.seated = true;
    taken++;
  }
  roster = [...members.values()]
    .sort((a, b) => a.since - b.since)
    .map(({ id, name, since, seated }) => ({ id, name, since, seated }));
}

/** The member a seat token belongs to, or null. */
function seated(seat: unknown): Entry | null {
  if (typeof seat !== "string" || !seat) return null;
  for (const entry of members.values()) if (entry.seat === seat) return entry;
  return null;
}

function checkSeat(seat: unknown): Entry {
  const entry = seated(seat);
  if (!entry) throw new Rejected("Every seat is taken, so you're watching");
  return entry;
}

/**
 * Present until the returned `leave` is called. The entry belongs to this
 * connection: a reconnect joins again under the same id before the dead
 * connection's cleanup has run, so it takes over the entry's place in line
 * and its seat, and that late `leave` removes only what it joined. Leaving
 * takes the member's pointer and what it was dragging or drawing, and gives
 * its seat to whoever has waited longest.
 */
export function join(me: Identity): { entry: Entry; leave: () => void } {
  const before = members.get(me.id);
  const entry: Entry = {
    id: me.id,
    name: me.name,
    since: before?.since ?? Date.now(),
    seated: !!before?.seat,
    seat: before?.seat ?? null
  };
  members.set(me.id, entry);
  seatEveryone();
  notify();
  notifyMembers();
  return {
    entry,
    leave() {
      if (members.get(me.id) !== entry) return;
      members.delete(me.id);
      pointers.delete(me.id);
      seatEveryone();
      notify();
      notifyMembers();
    }
  };
}

let membersVersion = 0;
const memberWaiters = new Set<() => void>();

function notifyMembers() {
  membersVersion++;
  const waking = [...memberWaiters];
  memberWaiters.clear();
  for (const wake of waking) wake();
}

/**
 * The seat token of the one watching (`entry`) now and whenever it changes:
 * null while it watches, its token once it has a seat. Ends when `signal`
 * aborts. Who else is here rides on the room's value, the same for everyone;
 * only the token is this viewer's.
 */
export async function* watchSeat(
  entry: Entry | null,
  signal?: AbortSignal
): AsyncGenerator<Presence> {
  let seen = -1;
  let sent: string | null | undefined;
  while (!signal?.aborted) {
    if (membersVersion !== seen) {
      seen = membersVersion;
      const seat = entry?.seat ?? null;
      if (seat !== sent) {
        sent = seat;
        yield { seat };
      }
      continue;
    }
    // Settles on the next join or leave, or when `signal` aborts: a
    // generator parked on an await cannot be returned until it settles, so
    // waiting only for the next change would run the caller's `finally` —
    // the leave — at the room's next join instead of at the disconnect.
    await new Promise<void>(resolve => {
      const wake = () => {
        memberWaiters.delete(wake);
        signal?.removeEventListener("abort", wake);
        resolve();
      };
      memberWaiters.add(wake);
      signal?.addEventListener("abort", wake, { once: true });
    });
  }
}

// ---------------------------------------------------------------------------
// Pointers. Each browser sends its latest position at most once per frame.

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const clamp = (n: number) => Math.round(Math.min(SIZE, Math.max(-SIZE, n)));

/** How many points a stroke may have; drawing on past it adds nothing. */
export const STROKE_LIMIT = 2000;
/** How many points of a line being drawn go in one chunk (see `Ink`). */
const CHUNK = 32;

/**
 * What a browser sends with its position while it draws: the stroke's key
 * and colour, and the points added since `from` (a count of points). One
 * position is in flight at a time, so `from` is where the last one that
 * landed left off; points the server already has are not added twice.
 */
export interface InkSent {
  key: string;
  color: string;
  from: number;
  points: number[];
}

const pointCount = (ink: Ink) => ink.chunks.reduce((n, chunk) => n + chunk.length / 2, 0);

function inked(held: Ink | undefined, sent: InkSent): Ink | undefined {
  if (
    typeof sent.key !== "string" ||
    !ID.test(sent.key) ||
    ended.has(sent.key) ||
    typeof sent.color !== "string" ||
    !COLOR.test(sent.color) ||
    !Number.isInteger(sent.from) ||
    !Array.isArray(sent.points) ||
    sent.points.length % 2 ||
    !sent.points.every(finite)
  )
    return held;
  const ink: Ink = held?.key === sent.key ? held : { key: sent.key, color: sent.color, chunks: [] };
  const have = pointCount(ink);
  // A gap means a position was lost on its way; the browser sends from the
  // last one that landed, so the next position fills it.
  if (sent.from > have) return ink;
  const fresh = sent.points.slice((have - sent.from) * 2, (STROKE_LIMIT - sent.from) * 2);
  if (!fresh.length) return ink;
  // Points go into the last chunk until it holds CHUNK points; a full chunk
  // is never changed again. A value then sends the one chunk that grew and
  // refers to the full ones: a chunk per frame would refer to every chunk
  // so far, every frame, and a long line would cost more each frame.
  const chunks = [...ink.chunks];
  let open = chunks.length && chunks[chunks.length - 1].length < CHUNK * 2 ? chunks.pop()! : [];
  for (const n of fresh.map(clamp)) {
    if (open.length === CHUNK * 2) {
      chunks.push(open);
      open = [];
    }
    open = [...open, n];
  }
  chunks.push(open);
  return { ...ink, chunks };
}

/**
 * Moves a present member's pointer, with the shape it drags or the stroke it
 * draws. Either left out keeps what the pointer had: a drag or a stroke
 * ends by the write it becomes (`moveShape`, `createStroke`) or by `drop`,
 * and anything sent for it after that only moves the pointer. Anyone without
 * a seat is ignored.
 */
export function point(
  seat: string,
  x: number,
  y: number,
  t: number,
  drag?: Drag,
  ink?: InkSent
): void {
  const member = seated(seat);
  if (!member || !finite(x) || !finite(y) || !finite(t)) return;
  const id = member.id;
  const before = pointers.get(id);
  let held = before?.drag;
  if (
    drag &&
    typeof drag.id === "string" &&
    typeof drag.key === "string" &&
    finite(drag.x) &&
    finite(drag.y) &&
    !ended.has(drag.key) &&
    shapes.some(s => s.id === drag.id)
  ) {
    held = { id: drag.id, key: drag.key, x: clamp(drag.x), y: clamp(drag.y) };
  }
  const drawing = ink ? inked(before?.ink, ink) : before?.ink;
  pointers.set(id, {
    id,
    name: member.name,
    x: clamp(x),
    y: clamp(y),
    t,
    ...(held && { drag: held }),
    ...(drawing && { ink: drawing })
  });
  notify();
}

/** Ends a drag or a stroke that did not become a write: nothing lands. */
export function drop(key: string): void {
  if (typeof key !== "string") return;
  end(key);
  if (release(key)) notify();
}

// Takes whatever any pointer holds or draws under `key` off it. True if one did.
function release(key: string): boolean {
  let found = false;
  for (const [member, pointer] of pointers) {
    if (pointer.drag?.key !== key && pointer.ink?.key !== key) continue;
    const { drag, ink, ...rest } = pointer;
    pointers.set(member, {
      ...rest,
      ...(drag && drag.key !== key && { drag }),
      ...(ink && ink.key !== key && { ink })
    });
    found = true;
  }
  return found;
}

function end(key: string) {
  ended.add(key);
  if (ended.size > 1024) ended.delete(ended.values().next().value!);
}

// ---------------------------------------------------------------------------
// Writes.

/** A write the room refused. The message is for the person who made it. */
export class Rejected extends Error {
  name = "Rejected";
}

const ID = /^[a-z0-9]{6,24}$/;
const COLOR = /^#[0-9a-f]{6}$/;

function checkId(id: unknown, what: string): asserts id is string {
  if (typeof id !== "string" || !ID.test(id)) throw new Rejected(`Bad ${what} id`);
}

function checkColor(color: unknown): asserts color is string {
  if (typeof color !== "string" || !COLOR.test(color)) throw new Rejected("Bad color");
}

function at(n: unknown): number {
  if (!finite(n)) throw new Rejected("Bad position");
  return clamp(n);
}

function shapeOf(id: string): Shape {
  const shape = shapes.find(s => s.id === id);
  if (!shape) throw new Rejected("That shape was deleted");
  return shape;
}

/**
 * A write to a shape that exists. `write` validates and changes the room; if
 * it throws, nothing changed and nothing is remembered. A mutation id the
 * room already applied is a retry of a write that landed, and does nothing.
 * Ids are minted by the browser at random, so one window serves everyone.
 */
function apply(mutation: string, write: () => void): void {
  checkId(mutation, "mutation");
  if (applied.includes(mutation)) return;
  write();
  applied = [...applied, mutation].slice(-APPLIED_KEPT);
  notify();
}

// A shape that changes is replaced, not edited: the yield before still holds
// the old object, and the one after has the new one where it was.
function replace(shape: Shape, next: Shape, toTop = false) {
  const index = shapes.indexOf(shape);
  if (toTop) {
    shapes.splice(index, 1);
    shapes.push(next);
  } else shapes[index] = next;
}

/** A create is acknowledged by its row: the id is the creating browser's. */
export function createShape(
  seat: string,
  id: string,
  kind: Kind,
  x: number,
  y: number,
  color: string
): void {
  checkSeat(seat);
  checkId(id, "shape");
  if (!(kind in SIZES)) throw new Rejected("Bad kind");
  checkColor(color);
  const left = at(x);
  const top = at(y);
  if (shapes.some(s => s.id === id)) return;
  if (shapes.length >= SHAPE_LIMIT)
    throw new Rejected(`The canvas is full (${SHAPE_LIMIT} shapes)`);
  const [w, h] = SIZES[kind];
  shapes.push({ id, kind, x: left, y: top, w, h, color, text: "" });
  notify();
}

/**
 * A drop. Its mutation id is the drag's key, so the same commit lands the
 * move, ends the drag on everyone's screen, and confirms it. A moved shape
 * comes to the top.
 */
export function moveShape(seat: string, mutation: string, id: string, x: number, y: number): void {
  try {
    checkSeat(seat);
    apply(mutation, () => {
      const shape = shapeOf(id);
      replace(shape, { ...shape, x: at(x), y: at(y) }, true);
      end(mutation);
      release(mutation);
    });
  } catch (err) {
    // Refused, the drag still ends: the shape stays where the room has it.
    drop(mutation);
    throw err;
  }
}

/**
 * A finished stroke, in canvas coordinates. Its id is the stroke's key, so
 * the same commit lands the shape and ends the ink every other screen was
 * drawing, and the row is its acknowledgement, as with any create.
 */
export function createStroke(seat: string, id: string, color: string, points: number[]): void {
  try {
    checkSeat(seat);
  } catch (err) {
    drop(id);
    throw err;
  }
  checkId(id, "stroke");
  checkColor(color);
  if (
    !Array.isArray(points) ||
    points.length < 4 ||
    points.length % 2 ||
    points.length > STROKE_LIMIT * 2 ||
    !points.every(finite)
  )
    throw new Rejected("Bad stroke");
  if (shapes.some(s => s.id === id)) return;
  if (shapes.length >= SHAPE_LIMIT)
    throw new Rejected(`The canvas is full (${SHAPE_LIMIT} shapes)`);
  const xs = points.filter((_, i) => i % 2 === 0).map(clamp);
  const ys = points.filter((_, i) => i % 2 === 1).map(clamp);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  shapes.push({
    id,
    kind: "stroke",
    x: left,
    y: top,
    w: Math.max(...xs) - left,
    h: Math.max(...ys) - top,
    color,
    text: "",
    points: xs.flatMap((x, i) => [x - left, ys[i] - top])
  });
  end(id);
  release(id);
  notify();
}

export function recolorShape(seat: string, mutation: string, id: string, color: string): void {
  checkSeat(seat);
  apply(mutation, () => {
    checkColor(color);
    const shape = shapeOf(id);
    replace(shape, { ...shape, color });
  });
}

export function writeNote(seat: string, mutation: string, id: string, text: string): void {
  checkSeat(seat);
  apply(mutation, () => {
    const shape = shapeOf(id);
    if (shape.kind !== "note") throw new Rejected("Only a note has words");
    replace(shape, { ...shape, text: typeof text === "string" ? text.slice(0, 280) : "" });
  });
}

/** Deleting what someone else already deleted is not a rejection: the room already says so. */
export function deleteShape(seat: string, mutation: string, id: string): void {
  checkSeat(seat);
  apply(mutation, () => {
    const index = shapes.findIndex(s => s.id === id);
    if (index >= 0) shapes.splice(index, 1);
  });
}

// ---------------------------------------------------------------------------
// The host's reset.

/**
 * Empties the room: every shape goes, and anything being dragged or drawn
 * ends. Only for whoever holds CANVAS_ADMIN_KEY; without one set, nobody.
 * The two refusals are worded apart: a server started without the key and
 * a mistyped key look the same from the page otherwise.
 */
export function clear(key: string): void {
  const admin = process.env.CANVAS_ADMIN_KEY?.trim();
  if (!admin) throw new Rejected("This server has no host key: start it with CANVAS_ADMIN_KEY set");
  if (typeof key !== "string" || key.trim() !== admin)
    throw new Rejected("That isn't the host key (?admin= must match CANVAS_ADMIN_KEY)");
  shapes.length = 0;
  for (const pointer of pointers.values()) {
    if (pointer.drag) end(pointer.drag.key);
    if (pointer.ink) end(pointer.ink.key);
    const { drag, ink, ...rest } = pointer;
    pointers.set(pointer.id, rest);
  }
  notify();
}
