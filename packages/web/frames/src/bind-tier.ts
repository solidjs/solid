/**
 * `@solidjs/web/frames/bind` — the frames client's BIND tier (frames
 * savings pass §3 row C6): binding-slot positions (server-components-
 * principles §9.2.3), loaded on demand through the tier mechanism
 * (`prepareTier("bind")`, frame-client.ts).
 *
 * A binding slot is a slot call READ AS DATA — `const row = props.row(args)`
 * — whose properties the server component binds at positions of its own
 * markup: an attribute, a class name or style property, a handler, a ref,
 * a text child. Each consuming element carries one marker per position
 * (`_s:<attribute>="<occurrence>:<key>[=<name>]"`, `_s:on:<event>`,
 * `_s:ref`; a text position is a comment pair `<!--_s:t=occ:key-->…
 * <!--/_s:t-->`), the occurrence is the CALL (one data context, any number
 * of consumers), and the client runs the fill once per occurrence and
 * writes each position from the object it returns.
 *
 * What rides in this chunk, and so leaves the eager frames client: the
 * marker grammar's readers — the entry parser, the consumer discovery the
 * slot sync's walk dispatches to (`positions` for an element's markers,
 * `text` for a text position's start) — the morph's OWNED-POSITION arms
 * (`owned` / `apply`: a position the client writes is left alone by the
 * morph, owned class names and style properties re-imposed over the
 * server's string), the per-frame consumer set and rebinder (`sync` /
 * `rebinder` / `unmount`: the sync hands the set it found at the mount and
 * on every re-sync; the tier compares and calls the mount's rebinder on a
 * change), and the binding itself (`bind`: the fill, the render effect
 * over every consumer, `assign`'s per-position diff — `@solidjs/web`'s
 * `assign` is this chunk's import, not the eager client's). The eager
 * client keeps the marker constants, one test (whether a node carries a
 * marker at all) and the morph's text-pair arm (a position's text survives
 * a morph by not being reconciled): its walk NOTES a marker met while this
 * tier is absent and the frame HOLDS on the note (frames-rulings 3.1 on
 * the adopt path — the server interior stays on screen, positions at the
 * server's values), the load started by the readiness check; the
 * install's flush re-walks with the tier in place and the occurrences
 * mount.
 *
 * The delegated-event REPLAY WINDOW (option (a) of the C6 ruling): a
 * consumer with a handler position (`_s:on:*`) is stamped `_hk` by the
 * server (ssrClaim, document face), so the hydration bootstrap files its
 * events behind the element's own completion instead of the nearest page
 * element's — which the page root's pass completes long before any frame
 * tier lands. The bind completes the element and calls
 * `runHydrationEvents`: a click before `hydrate()`, or during the hold,
 * replays into the handler the bind just attached. The frame's hold alone
 * does NOT bound that window (it bounds hydration-done); the stamp does.
 *
 * The module's exports ARE its dispatch: `prepareTier` stamps the load
 * with the module (`tierLoads.bind.r`) and the eager client calls the
 * appliers off the stamp. No `install()`: the tier registers nothing — its
 * per-frame state is keyed by the frame handed in. It imports the eager
 * client ENTRY for `isAsyncValue` (the shared instance, external in the
 * dist build — rollup.config.js's externalizeFramesClient resolves
 * `./client.js` to `@solidjs/web/frames`), as the traces and regions tiers
 * do for theirs; the import is also what keeps an app's bundler attaching
 * this chunk to the entry's graph: a lazy chunk that reaches `solid-js`
 * and `@solidjs/web` WITHOUT importing the chunk that loads it is split
 * from them (Rolldown 1.2 moves the shared runtime into a third chunk on
 * the live page — measured, C6), one that imports it shares them in
 * place. frame-client.js's constants and dev shape finders (`SLOT_MARKER`,
 * `SLOT_TEXT`, `shapeOf`, `slotShapeFinding`) bundle here as their own copy
 * — importless, no instance to agree with.
 *
 * The server announces this tier wherever a slot is read as data (the slot
 * proxy's `needs("bind")`, frame-sink.ts): `X-Frame-Tiers` / `chunk.tiers`
 * on a stream, `_$HY.r["sc:tiers"]` + a `modulepreload` on a document — so
 * the load is a warm start; an un-announced marker starts it from the walk
 * and the frame waits (the same DOM, later).
 * @experimental
 */
import { createRenderEffect, createSignal, onCleanup, untrack } from "solid-js";
// `assign` MUST be the shared @solidjs/web instance (external in
// rollup.config.js): it binds delegated handlers into the app's own event
// tables.
import { assign, runHydrationEvents } from "@solidjs/web";
import { sharedConfig } from "solid-js/internal";
// The eager frames client — the SHARED instance the app runs (see above).
import { isAsyncValue } from "./client.js";
// Own copies: the marker constants and the dev-only shape finders.
import { SLOT_MARKER, SLOT_TEXT, shapeOf, slotShapeFinding } from "./frame-client.js";

// Build-time literal (see diagnostics.ts): dev-only guidance folds out of
// the prod chunk (`bind.js`); the dev chunk (`bind.dev.js`, the
// `development` export condition) keeps it.
const IS_DEV = "_SOLID_DEV_" as unknown as boolean;

// === The marker grammar's readers ===

/**
 * One marker entry, `<occurrence>:<key>[=<name>]`, as `[occurrence,
 * { pos, key, name }]`, or null. Keys and names are percent-encoded on the
 * wire (they are client-controlled strings landing in a `,`/`:`/`=`-delimited
 * grammar) and decoded here.
 */
function slotEntry(entry: string, pos: string): [string, any] | null {
  const colon = entry.indexOf(":");
  if (colon < 1) return null;
  const eq = entry.indexOf("=", colon);
  return [
    entry.slice(0, colon),
    {
      pos,
      key: decodeURIComponent(eq === -1 ? entry.slice(colon + 1) : entry.slice(colon + 1, eq)),
      name: eq === -1 ? undefined : decodeURIComponent(entry.slice(eq + 1))
    }
  ];
}

/** An occurrence's consumer list, created on first use; null when a slot
 *  range claimed the id (the dev range check reports it). */
function consumersOf(elements: Map<string, any>, occurrence: string): any[] | null {
  let consumers = elements.get(occurrence);
  if (consumers === undefined) elements.set(occurrence, (consumers = []));
  return Array.isArray(consumers) ? consumers : null;
}

/**
 * Register a text start marker's position on its parent element's consumer
 * entry for the occurrence — the one its attribute markers opened, if any,
 * so an element is one consumer however its positions are spelled. The slot
 * sync's walk dispatches here (frame-client.ts `collectSlots`).
 */
export function text(start: Comment, elements: Map<string, any>): void {
  const parsed = slotEntry(start.data.slice(SLOT_TEXT.length), "text");
  const consumers = parsed && consumersOf(elements, parsed[0]);
  if (!consumers) return;
  const element = start.parentNode;
  let consumer;
  for (let i = consumers.length; i-- && !consumer; )
    if (consumers[i].element === element) consumer = consumers[i];
  consumer || consumers.push((consumer = { element, positions: [] }));
  parsed![1].start = start;
  consumer.positions.push(parsed![1]);
}

/**
 * Parse one element's `_s:*` markers into positions grouped by occurrence:
 * `{ [occurrence]: [{ pos, key, name }] }`, or null. `pos` is the marker's
 * position as written (`class`, `hidden`, `on:click`, `ref`), `name` the
 * class name / style property for a member position.
 */
function slotPositions(el: Element): Record<string, any[]> | null {
  const attrs = el.attributes;
  let out: Record<string, any[]> | null = null;
  for (let i = 0; i < attrs.length; i++) {
    const attr = attrs[i];
    if (!attr.name.startsWith(SLOT_MARKER)) continue;
    const pos = attr.name.slice(SLOT_MARKER.length);
    for (const entry of attr.value.split(",")) {
      const parsed = slotEntry(entry, pos);
      if (!parsed) continue;
      out || (out = Object.create(null));
      (out![parsed[0]] || (out![parsed[0]] = [])).push(parsed[1]);
    }
  }
  return out;
}

/**
 * An element's positions join each occurrence's consumer list, in document
 * order. The slot sync's walk dispatches here for every server element with
 * attributes (frame-client.ts `collectSlots`).
 */
export function positions(el: Element, elements: Map<string, any>): void {
  const byOccurrence = slotPositions(el);
  if (byOccurrence !== null) {
    for (const occurrence in byOccurrence) {
      const consumers = consumersOf(elements, occurrence);
      if (consumers) consumers.push({ element: el, positions: byOccurrence[occurrence] });
    }
  }
}

/** Whether a data occurrence's consumer set changed (elements or positions). */
function consumersEqual(a: any[], b: any[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x.element !== y.element || x.positions.length !== y.positions.length) return false;
    for (let j = 0; j < x.positions.length; j++) {
      const p = x.positions[j];
      const q = y.positions[j];
      if (p.pos !== q.pos || p.key !== q.key || p.name !== q.name || p.start !== q.start)
        return false;
    }
  }
  return true;
}

// === The per-frame consumer set ===

/** One data occurrence's state on a frame: the consumer set last handed
 *  to the mount, and the mount's rebind callback (`ctx.onRebind`). */
interface Occurrence {
  consumers: any[] | undefined;
  rebind: ((consumers: any[]) => void) | undefined;
}
// Per frame: occurrence -> state. Weak, so a frame that goes takes its
// occurrences with it; `unmount` drops an occurrence the stream dropped.
const byFrame = new WeakMap<object, Map<string, Occurrence>>();
function occurrencesOf(frame: object): Map<string, Occurrence> {
  let slots = byFrame.get(frame);
  if (!slots) byFrame.set(frame, (slots = new Map()));
  return slots;
}

/**
 * The consumer set the slot sync found for a MOUNTED data occurrence — at
 * the mount (the set the fill was handed) and on every re-sync. A changed
 * set (a morph replaced one of its elements, a response added or dropped a
 * bound position) rebinds in place through the mount's rebinder: the fill's
 * computation stays, the binding gets the new set.
 */
export function sync(frame: object, occurrence: string, consumers: any[]): void {
  const slots = occurrencesOf(frame);
  const entry = slots.get(occurrence);
  // The mount: the invocation registered its rebinder first (`rebinder`),
  // and the set it was handed is recorded without a rebind — the fill's
  // signal already holds it.
  if (!entry) slots.set(occurrence, { consumers, rebind: undefined });
  else if (!entry.consumers) entry.consumers = consumers;
  else if (!consumersEqual(entry.consumers, consumers)) {
    entry.consumers = consumers;
    entry.rebind && entry.rebind(consumers);
  }
}

/** The mount's rebind callback (`ctx.onRebind`), registered during the
 *  invocation — before `sync` records the mount's set. */
export function rebinder(frame: object, occurrence: string, fn: (consumers: any[]) => void): void {
  const slots = occurrencesOf(frame);
  const entry = slots.get(occurrence);
  if (entry) entry.rebind = fn;
  else slots.set(occurrence, { consumers: undefined, rebind: fn });
}

/** The occurrence is gone (unmounted, or re-invoked: the new invocation
 *  registers its own rebinder). */
export function unmount(frame: object, occurrence: string): void {
  byFrame.get(frame)?.delete(occurrence);
}

// === The morph's owned-position arms ===

/** The positions of an incoming element a client fill writes (see
 *  `owned`). */
interface Owned {
  attrs: Set<string>;
  class: string[] | null;
  style: string[] | null;
}

// Binding-slot ownership (principles §9.2.3). The INCOMING element's `_s:*`
// markers say which of its positions a client fill writes: `_s:hidden` owns
// the `hidden` attribute; `_s:class="occ:k=done"` owns the class name
// `done` and `_s:class="occ:k"` the whole `class` string (likewise `style`
// and its properties); `_s:on:*` / `_s:ref` are not attributes and need no
// guard. A position the client owns is left alone by the morph: not
// removed, not set. `class`/`style` are shared attributes — the server's
// classes and the fill's toggled names live in one string — so when a fill
// owns NAMES within them the morph applies the server's value and re-imposes
// the owned names' live state on top. The markers themselves are ordinary
// attributes and morph like any other, which is what lets the slot sync
// see a consumer change.
export function owned(el: Element): Owned | null {
  const attrs = el.attributes;
  let out: Owned | null = null;
  for (let i = 0; i < attrs.length; i++) {
    const name = attrs[i].name;
    if (!name.startsWith(SLOT_MARKER)) continue;
    const pos = name.slice(SLOT_MARKER.length);
    if (pos === "ref" || pos.startsWith("on:")) continue;
    out || (out = { attrs: new Set(), class: null, style: null });
    if (pos !== "class" && pos !== "style") {
      out.attrs.add(pos);
      continue;
    }
    for (const entry of attrs[i].value.split(",")) {
      const eq = entry.indexOf("=");
      if (eq === -1) {
        out.attrs.add(pos); // a whole-value read owns the attribute
        continue;
      }
      (out[pos] || (out[pos] = [])).push(decodeURIComponent(entry.slice(eq + 1)));
    }
  }
  return out;
}

/** Set `class` to the server's value with the fill-owned class names' live
 *  state preserved. Returns whether the attribute changed. */
function morphOwnedClass(oldEl: Element, value: string, names: string[]): boolean {
  const list = oldEl.classList;
  const set = new Set(value ? value.split(/\s+/) : []);
  set.delete("");
  for (const name of names) list.contains(name) ? set.add(name) : set.delete(name);
  const next = [...set].join(" ");
  if (next === (oldEl.getAttribute("class") || "")) return false;
  next ? oldEl.setAttribute("class", next) : oldEl.removeAttribute("class");
  return true;
}

/** Set `style` to the server's value with the fill-owned properties' live
 *  values preserved. Returns whether the attribute changed. */
function morphOwnedStyle(oldEl: HTMLElement, value: string, names: string[]): boolean {
  const style = oldEl.style;
  const saved = names.map(name => [
    name,
    style.getPropertyValue(name),
    style.getPropertyPriority(name)
  ]);
  const before = oldEl.getAttribute("style");
  value ? oldEl.setAttribute("style", value) : oldEl.removeAttribute("style");
  for (const [name, v, priority] of saved) {
    v ? style.setProperty(name, v, priority) : style.removeProperty(name);
  }
  return oldEl.getAttribute("style") !== before;
}

/**
 * Apply the server's value for `name` (null: absent) to an element with
 * binding-slot positions: a client-owned attribute is left alone; owned
 * `class`/`style` NAMES are re-imposed over the server's string. Returns
 * whether the attribute changed, or undefined when the position is not
 * owned and the caller writes it. (The eager wrapper answers `undefined`
 * itself for a null `owned`; the arms call here with one.)
 */
export function apply(
  oldEl: Element,
  name: string,
  value: string,
  owned: Owned
): boolean | undefined {
  if (owned.attrs.has(name)) return false;
  if ((name === "class" || name === "style") && owned[name] !== null) {
    return name === "class"
      ? morphOwnedClass(oldEl, value, owned.class!)
      : morphOwnedStyle(oldEl as HTMLElement, value, owned.style!);
  }
  return undefined;
}

// === The binding ===

interface ElementState {
  /** `assign`'s diff state: the props last written to the element. */
  prev: Record<string, any>;
  /** Bound handler props (`onclick`): the key and the value read at bind. */
  handlers: Record<string, { key: string; value: any }>;
  /** The ref dispatcher for the element's current ref keys, and those keys. */
  ref: ((el: Element) => void) | undefined;
  refId: string;
}

/**
 * The occurrence holding each handler prop of an element. A rebind can hand
 * an element from one occurrence to another (a positional id now names
 * another row's data), and a delegated handler is one slot on the element:
 * the outgoing occurrence's release must not clear what the incoming one set.
 */
const handlerOwners = new WeakMap<Element, Record<string, object>>();

/**
 * Bind a binding-slot occurrence (principles §9.2.3). The fill runs ONCE,
 * untracked, under the occurrence's owner — a component body: a top-level
 * read is a one-time read (dev names it through `untrack`'s label), and state
 * created in the body lives as long as the occurrence. Its object's value
 * positions are written by one render effect over every consuming element,
 * diffed per position by `assign`, so a getter's change re-reads the
 * occurrence and touches only what moved. Handlers and refs are read once
 * when an element binds and handed to `assign`, which binds them as client
 * JSX does (delegation, tuples). A consumer change (`ctx.onRebind`: the morph
 * replaced an element, a response bound a new position) rebinds without
 * re-running the fill. The client entry's `slotsFor` dispatches here under
 * the occurrence's owner (client.ts).
 */
export function bind(
  fill: (args: any) => any,
  args: any,
  ctx: any,
  label: string | undefined
): void {
  const [consumers, setConsumers] = createSignal<any[]>(ctx.positions);
  ctx.onRebind(setConsumers);
  const raw = untrack(() => fill(args), label);
  // Content where data was expected: a DOM node is an object, so it is
  // named here rather than read as one (its properties are the DOM's); an
  // async value has no properties to bind until it settles.
  const node = typeof Node === "function" && raw instanceof Node;
  const pending = isAsyncValue(raw);
  if (IS_DEV && (raw == null || typeof raw !== "object" || Array.isArray(raw) || node || pending)) {
    const shape = shapeOf(raw);
    slotShapeFinding(
      { reason: "fill-shape", occurrence: ctx.key, shape },
      `[BINDING_SLOT_POSITION] The fill for \`${ctx.key}\` returned ${shape}; server markup reads ` +
        `its properties at bound positions, so it must return an object (\`{ done, onToggle, … }\`). ` +
        `Nothing binds.`
    );
  }
  const out = raw == null || typeof raw !== "object" || node || pending ? {} : raw;
  const token = {};
  const state = new WeakMap<Element, ElementState>();
  // The elements written last time: one that drops out of the consumer
  // list on a rebind (its markers gone, the element kept by the morph) is
  // released so its handlers unbind.
  let bound = new Set<Element>();
  createRenderEffect(
    () => consumers().map(valuesFor),
    writes => {
      const next = new Set<Element>();
      for (const { element, positions, values, texts } of writes) {
        next.add(element);
        write(element, positions, values);
        for (const [start, v, key] of texts) writeText(start, v, key);
      }
      for (const element of bound) if (!next.has(element)) release(element);
      bound = next;
    }
  );
  // The occurrence's end (a later response dropped it, a positional id now
  // names another row's data) unbinds what it bound: the element may outlive
  // the occurrence (a morph keeps un-keyed elements) and another occurrence
  // may bind it next, so a handler left behind fires a disposed fill's.
  onCleanup(() => {
    for (const element of bound) release(element);
  });
  // Value positions are READ in the compute phase: a getter read here
  // tracks, so the occurrence re-writes when its sources move. Text
  // positions are values too, collected apart: they are nodes, not props.
  function valuesFor({ element, positions }: { element: Element; positions: any[] }) {
    const props: Record<string, any> = {};
    const texts: [Comment, unknown, string][] = [];
    let classNames: Record<string, boolean> | null = null;
    let styleProps: Record<string, any> | null = null;
    for (const { pos, key, name, start } of positions) {
      if (pos === "ref" || pos.startsWith("on:")) continue;
      if (pos === "text") texts.push([start, out[key], key]);
      else if (pos === "class" || pos === "style") {
        if (name === undefined) props[pos] = out[key];
        else if (pos === "class") (classNames || (classNames = {}))[name] = !!out[key];
        else (styleProps || (styleProps = {}))[name] = out[key];
      } else props[pos] = out[key];
    }
    if (classNames !== null && !("class" in props)) props.class = classNames;
    if (styleProps !== null && !("style" in props)) props.style = styleProps;
    return { element, positions, values: props, texts };
  }
  function write(element: Element, positions: any[], props: Record<string, any>) {
    let st = state.get(element);
    if (!st) state.set(element, (st = { prev: {}, handlers: {}, ref: undefined, refId: "" }));
    // Handler positions: the marker's event name (`onClick` compiled to
    // `click`) as the prop `assign` binds. The prop must be `on` + an
    // uppercase letter (`onClick`) — a lowercase `onclick` is an attribute
    // to `assign`. The server merges duplicate handlers last-wins, so a
    // position names one key; given more, the last. Several keys at a ref
    // position all fire, in marker order.
    const handlers: Record<string, string> = {};
    const refKeys: string[] = [];
    for (const { pos, key } of positions) {
      if (pos === "ref") refKeys.push(key);
      else if (pos.startsWith("on:")) handlers["on" + pos[3].toUpperCase() + pos.slice(4)] = key;
    }
    let owners = handlerOwners.get(element);
    if (!owners) handlerOwners.set(element, (owners = {}));
    let events = false;
    for (const prop in handlers) {
      events = true;
      const key = handlers[prop];
      let h = st.handlers[prop];
      if (h === undefined || h.key !== key)
        st.handlers[prop] = h = { key, value: untrack(() => out[key]) };
      props[prop] = h.value;
      owners[prop] = token;
    }
    // A handler the server released (or this occurrence let go of) is
    // unbound through `assign`'s diff — unless another occurrence has taken
    // the element's handler since, which is then not ours to clear.
    const clearing: Record<string, true> = {};
    for (const prop in st.handlers) {
      if (prop in handlers) continue;
      delete st.handlers[prop];
      if (owners[prop] === token) {
        delete owners[prop];
        clearing[prop] = true;
      }
    }
    if (refKeys.length) {
      // One stable ref per key set: `assign` fires a ref when its value
      // changes; a rebind that changes the bound keys fires it once.
      const id = refKeys.join(",");
      if (st.refId !== id) {
        const refs = refKeys.map(k => untrack(() => out[k]));
        st.refId = id;
        st.ref = (el: Element) => {
          for (const r of refs) typeof r === "function" && r(el);
        };
      }
      props.ref = st.ref;
    }
    // A value position the server RELEASED (a rebind whose incoming markup
    // no longer marks it) is the server's again, and the morph already
    // wrote the server's value there. Drop it from the diff state so
    // `assign` does not null the attribute the morph just applied. The ref
    // is the client's alone: it stays in `prev` and clears through the diff.
    for (const k in st.prev) {
      if (k in props || k === "ref" || k in clearing) continue;
      delete st.prev[k];
    }
    assign(element, props, true, st.prev);
    // Option (a) of the replay-window ruling (frames-rulings 3.1, C6): an
    // event-slot consumer carries its own `_hk` (the server stamps one on
    // an element with an `_s:on:*` position — ssrClaim, server.ts), so the
    // hydration bootstrap queued its events while the element was not
    // completed — the page root's pass never completes it (frame interiors
    // are not its to claim). Its handlers are bound now: complete it and
    // replay the queue (`runHydrationEvents` drains what is completed, in
    // order). Once per element; a page that never hydrated has no set.
    if (events && sharedConfig.completed && !sharedConfig.completed.has(element)) {
      sharedConfig.completed.add(element);
      runHydrationEvents();
    }
  }
  function release(element: Element) {
    if (!state.has(element)) return;
    write(element, [], {});
    state.delete(element);
  }
  // A text position renders as a client insert renders a primitive: a
  // string or number as text, nullish and booleans as nothing. Anything
  // else is content, which belongs in a template slot.
  function writeText(start: Comment, v: unknown, key: string) {
    let s = "";
    if (typeof v === "string" || typeof v === "number") s = "" + v;
    else if (IS_DEV && v != null && typeof v !== "boolean") {
      const shape = shapeOf(v);
      slotShapeFinding(
        { reason: "text-shape", occurrence: ctx.key, key, shape },
        `[BINDING_SLOT_POSITION] \`${key}\` of \`${ctx.key}\` is placed as text, but the fill ` +
          `returned ${shape} for it. A text position renders a string or number; markup belongs ` +
          `in a template slot. The text is cleared.`
      );
    }
    const n = start.nextSibling;
    if (n && n.nodeType === 3) {
      if ((n as Text).data !== s) (n as Text).data = s;
    } else if (s) start.after(s);
  }
}
