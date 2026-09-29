// Compile-only guard for `BindingSlot`'s return constraint (principles
// §9.2.3): a fill returns a plain object, and every other shape — an array,
// a DOM node, a function, an async value, an object with a `$`-prefixed key
// — types the slot's return as a `SlotError` naming the reason. That fails
// on both sides of the border: where the client passes its fill, and where
// the server reads the slot's properties. A valid slot is untouched on both.
// Runs under `test-types` against the built frames types (`pnpm types`
// first).
import type { BindingSlot } from "@solidjs/web/frames";

type Toggle = { done: boolean; onToggle: () => void };

// ---- valid: untouched on both sides ----

declare const server: {
  toggle: BindingSlot<{ id: string }, Toggle>;
  bare: BindingSlot<{}, Toggle>;
};
const row = server.toggle({ id: "1", $key: 1 });
const done: boolean = row.done;
const onToggle: () => void = row.onToggle;
server.bare();
// @ts-expect-error a slot with args is called with them
server.toggle();

const toggleFill: BindingSlot<{ id: string }, Toggle> = p => ({
  get done() {
    return p.id === "1";
  },
  onToggle() {}
});
const bareFill: BindingSlot<{}, Toggle> = () => ({ done: true, onToggle() {} });

// ---- rejected shapes: the client's fill ----

// @ts-expect-error binding slot output must be an object, not an array
const arrayFill: BindingSlot<{}, string[]> = () => ["a"];
// @ts-expect-error binding slot output must be an object, not a DOM node
const nodeFill: BindingSlot<{}, HTMLElement> = () => document.createElement("div");
// @ts-expect-error binding slot output must be an object, not a function
const functionFill: BindingSlot<{}, () => Toggle> = () => () => ({ done: true, onToggle() {} });
// @ts-expect-error binding slot output must be settled, not async
const asyncFill: BindingSlot<{}, Promise<Toggle>> = async () => ({ done: true, onToggle() {} });
// @ts-expect-error reserved key: $x
const reservedFill: BindingSlot<{}, { $x: number; ok: boolean }> = () => ({ $x: 1, ok: true });

// ---- rejected shapes: the server's read ----

declare const rejected: {
  array: BindingSlot<{}, string[]>;
  node: BindingSlot<{}, HTMLElement>;
  fn: BindingSlot<{}, () => Toggle>;
  pending: BindingSlot<{}, Promise<Toggle>>;
  reserved: BindingSlot<{}, { $x: number; ok: boolean }>;
};
// @ts-expect-error an array output has no properties to bind
rejected.array().length;
// @ts-expect-error a DOM node output has no properties to bind
rejected.node().className;
// @ts-expect-error a function output has no properties to bind
rejected.fn().name;
// @ts-expect-error an async output has no properties to bind
rejected.pending().then;
// @ts-expect-error an object with a reserved key has no properties to bind
rejected.reserved().ok;

export {
  done,
  onToggle,
  toggleFill,
  bareFill,
  arrayFill,
  nodeFill,
  functionFill,
  asyncFill,
  reservedFill
};
