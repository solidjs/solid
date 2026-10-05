/**
 * Creation during a foreign hold (A29's creation-time form, 2026-10-05).
 *
 * - #3802: a render effect born held inside a mount whose flush joined the
 *   hold has no committed value; a mainline write to another of its
 *   dependencies re-stages it and owes no run — its first run is the
 *   commit's.
 */
import { describe, expect, it } from "vitest";
import {
  action,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush
} from "../src/index.js";

const tick = async () => {
  await Promise.resolve();
  await Promise.resolve();
  flush();
};

function hold(write: () => void) {
  let release!: () => void;
  action(function* () {
    write();
    yield new Promise<void>(resolve => (release = resolve));
  })();
  flush();
  return () => release();
}

describe("#3802: a born-held render effect re-derived by a mainline write", () => {
  it("re-stages and owes no run; the commit's first run shows the latest pass", async () => {
    const [value, setValue] = createSignal(false);
    const [mounted, setMounted] = createSignal(false);
    const [title, setTitle] = createSignal("");
    const log: string[] = [];
    createRoot(() => {
      // <Show when={mounted()}>{() => { createMemo(value); return <div …/> }}</Show>
      createRenderEffect(
        () => {
          if (!mounted()) return "none";
          createMemo(() => value());
          createRenderEffect(
            () => ({ cls: value(), title: title() }),
            ({ cls, title }) => {
              log.push(`div ${cls} ${title}`);
            }
          );
          return "child";
        },
        v => {
          log.push(`show ${v}`);
        }
      );
    });
    flush();
    const release = hold(() => setValue(true));
    log.length = 0;

    // In a flush: the mount's memo reads the held value, the flush joins the
    // hold, and the whole mount is born held with it (the tick is the frame).
    setMounted(true);
    flush();
    expect(log).toEqual([]);

    // A mainline write to the div's other dependency: no run before the
    // commit (the run would apply a value the effect never committed).
    setTitle("Updated");
    expect(() => flush()).not.toThrow();
    expect(log).toEqual([]);

    release();
    await tick();
    expect(log.sort()).toEqual(["div true Updated", "show child"]);
  });
});
