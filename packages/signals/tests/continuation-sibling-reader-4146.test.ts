/**
 * #4146 — whether a later, independent store write is held while an action's
 * continuation write to a SIBLING property stays pending must not depend on
 * whether a live render effect reads the written property.
 *
 * Timeline: an action writes optimistic `card.version`, yields gate 1; its
 * continuation writes truth `committed` and `card.version`, then yields gate 2
 * (left open). Outside the action, a plain write sets `card.text`. The plain
 * read of `card.text` must be the same in every reader configuration.
 */
import { describe, expect, it } from "vitest";
import {
  action,
  createOptimisticStore,
  createRenderEffect,
  createRoot,
  createStore,
  flush,
  latest
} from "../src/index.js";

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>(r => (resolve = r));
  return { promise, resolve };
}

async function settle() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
  await new Promise(r => setTimeout(r, 0));
  flush();
  for (let i = 0; i < 4; i++) await Promise.resolve();
  flush();
}

type Reader = "none" | "plain" | "latest" | "effect" | "disposed-effect";

async function run(reader: Reader) {
  const first = deferred();
  const last = deferred();
  let dispose!: () => void;
  const m = createRoot(stop => {
    dispose = stop;
    const [state, setState] = createStore({
      committed: 0,
      cards: [{ version: 0, text: "" }]
    });
    const [, setView] = createOptimisticStore(state);
    const observations: string[] = [];
    const watchText = () =>
      createRenderEffect(
        () => state.cards[0].text,
        text => void observations.push(text)
      );
    if (reader === "plain") void state.cards[0].text;
    if (reader === "latest") latest(() => state.cards[0].text);
    if (reader === "effect") watchText();
    if (reader === "disposed-effect") {
      const stopReader = createRoot(stop => {
        watchText();
        return stop;
      });
      flush();
      stopReader();
    }
    const go = action(function* () {
      setView(s => {
        s.cards[0].version = 1;
      });
      yield first.promise;
      setState(s => {
        s.committed = 1;
        s.cards[0].version = 1;
      });
      yield last.promise;
    });
    return { state, setState, observations, go };
  });
  flush();
  const completion = m.go();
  flush();
  first.resolve();
  await settle();
  expect(m.state.cards[0].version).toBe(0);
  expect(latest(() => m.state.cards[0].version)).toBe(1);

  m.setState(s => {
    s.cards[0].text = "a";
  });
  await settle();
  const pending = { text: m.state.cards[0].text, version: m.state.cards[0].version };

  last.resolve();
  await completion;
  await settle();
  const final = { text: m.state.cards[0].text, version: m.state.cards[0].version };
  dispose();
  flush();
  return { pending, final, observations: m.observations };
}

describe("#4146 live reader must not change sibling-write hold membership", () => {
  it("plain read of the independent write is reader-invariant", async () => {
    const results: Record<string, unknown> = {};
    for (const reader of ["none", "plain", "latest", "effect", "disposed-effect"] as const) {
      results[reader] = await run(reader);
    }
    const none = results.none as Awaited<ReturnType<typeof run>>;
    for (const reader of ["plain", "latest", "effect", "disposed-effect"] as const) {
      const r = results[reader] as Awaited<ReturnType<typeof run>>;
      expect({ reader, pending: r.pending }).toEqual({ reader, pending: none.pending });
      expect(r.final).toEqual({ text: "a", version: 1 });
    }
    // The held sibling write stays held regardless of readers.
    expect(none.pending.version).toBe(0);
    // The write to `text` touched nothing the action wrote: it publishes now.
    expect(none.pending.text).toBe("a");
  });

  it("plain store, no continuation: an unread sibling publishes at the flush, not before", async () => {
    const gate = deferred();
    const [state, setState] = createStore({ card: { version: 0, text: "" } });
    flush();
    const save = action(function* () {
      setState(s => {
        s.card.version = 1;
      });
      yield gate.promise;
    });
    const p = save();
    flush();
    setState(s => {
      s.card.text = "a";
    });
    // A28: visible at the flush, not at the write.
    expect(state.card.text).toBe("");
    flush();
    expect(state.card.text).toBe("a");
    expect(state.card.version).toBe(0);
    gate.resolve();
    await p;
    flush();
    expect(state.card).toEqual({ version: 1, text: "a" });
  });

  it("a reader disposed after the write does not pull the key back into the hold", async () => {
    const gate = deferred();
    const [state, setState] = createStore({ card: { version: 0, text: "" } });
    const stop = createRoot(dispose => {
      createRenderEffect(
        () => state.card.text,
        () => {}
      );
      return dispose;
    });
    flush();
    const save = action(function* () {
      setState(s => {
        s.card.version = 1;
      });
      yield gate.promise;
    });
    const p = save();
    flush();
    setState(s => {
      s.card.text = "a";
    });
    flush();
    expect(state.card.text).toBe("a");
    stop();
    flush();
    expect(state.card.text).toBe("a");
    expect(state.card.version).toBe(0);
    gate.resolve();
    await p;
    flush();
    expect(state.card).toEqual({ version: 1, text: "a" });
  });

  it("contrast: a mainline write to the key the hold changed stays held (A34)", async () => {
    const gate = deferred();
    const [state, setState] = createStore({ card: { version: 0, text: "" } });
    flush();
    const save = action(function* () {
      setState(s => {
        s.card.version = 1;
      });
      yield gate.promise;
    });
    const p = save();
    flush();
    setState(s => {
      s.card.version = 2;
    });
    flush();
    expect(state.card.version).toBe(0);
    gate.resolve();
    await p;
    flush();
    expect(state.card.version).toBe(2);
  });
});
