/**
 * #3743 — a fold repeats no unchanged presence to a held node.
 *
 * A fold's notifications are a DIFF against the view the nodes were last
 * told (#3296): the value loop (`notifyKeyDiff`/`notifyKeyValue`) already
 * wrote only changed keys; the presence loop (`notifyFoldTail`) wrote every
 * observed `in` node with `key in neu`. `setSignal` joins a held node's
 * transaction before its equality gate (A34 (1): a write to a held node is a
 * second proposal, the same value or another), so a `reconcile()` outside an
 * action that had deleted an observed key — the incoming snapshot leaving
 * it absent too — made the whole mainline tick the action's: an unrelated
 * `a.value` stayed stale until the action settled. A real presence change
 * still writes and still proposes on a held node (the "contrast" cases).
 *
 * Wide object: an owned record above the overlay threshold drafts as a
 * prototype overlay (`Object.create(v)`, #3044), which reads a key the draft
 * deleted as present through its prototype; `applyAdopt` materializes it
 * before taking its diff base, so the presence AND value diffs see the
 * deletion (the value-node twin is pinned here too — before, the restoring
 * reconcile skipped the held leaf and it committed the draft's `undefined`).
 *
 * Optimistic twin (S4, last case): with presence diffed, a landing that
 * changes no guessed key's truth reaches the lane only through the
 * container's arrangement guess — judged by every arrangement-changing
 * landing, whether or not anything subscribes to the container.
 */
import { describe, expect, it } from "vitest";
import {
  action,
  createOptimisticStore,
  createProjection,
  createRenderEffect,
  createRoot,
  createSignal,
  createStore,
  flush,
  reconcile
} from "../../src/index.js";

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>(r => (resolve = r));
  return { promise, resolve };
}

describe("#3743 unchanged presence under an open action", () => {
  it("reconcile reveals an unrelated value while an action holds a deleted key", async () => {
    const gate = deferred();
    const [state, setState] = createStore<{ a: { value: number }; b: { failed?: boolean } }>({
      a: { value: 0 },
      b: { failed: true }
    });
    const values: number[] = [];
    const presence: boolean[] = [];
    createRoot(() => {
      createRenderEffect(
        () => state.a.value,
        v => void values.push(v)
      );
      createRenderEffect(
        () => "failed" in state.b,
        v => void presence.push(v)
      );
    });
    flush();
    expect(values).toEqual([0]);
    expect(presence).toEqual([true]);

    const removeFlag = action(function* removeFlag() {
      setState(d => {
        delete d.b.failed;
      });
      yield gate.promise;
    });
    const p = removeFlag();
    flush();
    expect(values).toEqual([0]);
    expect(presence).toEqual([true]);

    setState(reconcile({ a: { value: 1 }, b: {} }));
    flush();
    expect(values).toEqual([0, 1]);
    expect(presence).toEqual([true]);

    gate.resolve();
    await p;
    flush();
    expect(values).toEqual([0, 1]);
    expect(presence).toEqual([true, false]);
  });

  it("contrast: reconcile restoring the deleted key proposes on the held node and rides the action", async () => {
    const gate = deferred();
    const [state, setState] = createStore<{ a: { value: number }; b: { failed?: boolean } }>({
      a: { value: 0 },
      b: { failed: true }
    });
    const values: number[] = [];
    const presence: boolean[] = [];
    createRoot(() => {
      createRenderEffect(
        () => state.a.value,
        v => void values.push(v)
      );
      createRenderEffect(
        () => "failed" in state.b,
        v => void presence.push(v)
      );
    });
    flush();

    const removeFlag = action(function* removeFlag() {
      setState(d => {
        delete d.b.failed;
      });
      yield gate.promise;
    });
    const p = removeFlag();
    flush();

    setState(reconcile({ a: { value: 1 }, b: { failed: true } }));
    flush();
    expect(values).toEqual([0]);
    expect(presence).toEqual([true]);

    gate.resolve();
    await p;
    flush();
    expect(values).toEqual([0, 1]);
    expect(presence.at(-1)).toBe(true);
    expect("failed" in state.b).toBe(true);
  });

  describe("wide object (overlay draft)", () => {
    const WIDE = 40;
    type Wide = { [k: `k${number}`]: number; failed?: boolean };
    const wide = (): Wide =>
      Object.fromEntries(Array.from({ length: WIDE }, (_, i) => [`k${i}`, i]));

    function setup() {
      const [state, setState] = createStore<{
        a: { value: number };
        b: Wide;
      }>({ a: { value: 0 }, b: { ...wide(), failed: true } });
      const values: number[] = [];
      const presence: boolean[] = [];
      createRoot(() => {
        createRenderEffect(
          () => state.a.value,
          v => void values.push(v)
        );
        createRenderEffect(
          () => "failed" in state.b,
          v => void presence.push(v)
        );
      });
      flush();
      setState(d => {
        d.b.k0 = -1;
      });
      flush();
      expect(values).toEqual([0]);
      expect(presence).toEqual([true]);
      return { state, setState, values, presence };
    }

    it("reconcile reveals an unrelated value while an action holds a deleted key", async () => {
      const gate = deferred();
      const { state, setState, values, presence } = setup();
      const removeFlag = action(function* removeFlag() {
        setState(d => {
          delete d.b.failed;
        });
        yield gate.promise;
      });
      const p = removeFlag();
      flush();

      setState(reconcile({ a: { value: 1 }, b: { ...wide(), k0: -1 } }));
      flush();
      expect(values).toEqual([0, 1]);
      expect(presence).toEqual([true]);

      gate.resolve();
      await p;
      flush();
      expect(values).toEqual([0, 1]);
      expect(presence).toEqual([true, false]);
      expect("failed" in state.b).toBe(false);
    });

    it("contrast: reconcile restoring the deleted key proposes on the held node and rides the action", async () => {
      const gate = deferred();
      const { state, setState, values, presence } = setup();
      const removeFlag = action(function* removeFlag() {
        setState(d => {
          delete d.b.failed;
        });
        yield gate.promise;
      });
      const p = removeFlag();
      flush();

      setState(reconcile({ a: { value: 1 }, b: { ...wide(), k0: -1, failed: true } }));
      flush();
      expect(values).toEqual([0]);
      expect(presence).toEqual([true]);

      gate.resolve();
      await p;
      flush();
      expect(values).toEqual([0, 1]);
      expect(presence.at(-1)).toBe(true);
      expect("failed" in state.b).toBe(true);
    });

    it("value twin: reconcile restoring the deleted key re-proposes on the held leaf, which lands true", async () => {
      // The same overlay base, read as a VALUE: through the overlay's
      // prototype the deleted key still read `true`, equal to the restored
      // `true`, so the leaf (staged `undefined` by the draft) was skipped and
      // committed `undefined` at the landing beside a backing that had it.
      const gate = deferred();
      const [state, setState] = createStore<{
        a: { value: number };
        b: Wide;
      }>({ a: { value: 0 }, b: { ...wide(), failed: true } });
      const values: number[] = [];
      const failed: (boolean | undefined)[] = [];
      createRoot(() => {
        createRenderEffect(
          () => state.a.value,
          v => void values.push(v)
        );
        createRenderEffect(
          () => state.b.failed,
          v => void failed.push(v)
        );
      });
      flush();
      setState(d => {
        d.b.k0 = -1;
      });
      flush();
      expect(values).toEqual([0]);
      expect(failed).toEqual([true]);

      const removeFlag = action(function* removeFlag() {
        setState(d => {
          delete d.b.failed;
        });
        yield gate.promise;
      });
      const p = removeFlag();
      flush();

      setState(reconcile({ a: { value: 1 }, b: { ...wide(), k0: -1, failed: true } }));
      flush();
      // A34 (1): the restore is a second proposal on the held leaf — the
      // tick rides the action.
      expect(values).toEqual([0]);
      expect(failed).toEqual([true]);

      gate.resolve();
      await p;
      flush();
      expect(values).toEqual([0, 1]);
      expect(failed.at(-1)).toBe(true);
      expect(state.b.failed).toBe(true);
    });
  });

  it("a projection adopting away from a chained store still writes presence the inner store changed", () => {
    const [inner, setInner] = createStore<{ k?: number }>({ k: 1 });
    const [mode, setMode] = createSignal<"inner" | "empty" | "plain">("inner");
    const presence: boolean[] = [];
    createRoot(() => {
      const proj = createProjection(
        () => {
          const m = mode();
          return m === "inner" ? inner : m === "empty" ? {} : { k: 1 };
        },
        {} as { k?: number }
      );
      createRenderEffect(
        () => "k" in proj,
        v => void presence.push(v)
      );
    });
    flush();
    expect(presence).toEqual([true]);

    setInner(d => {
      delete d.k;
    });
    flush();
    expect(presence).toEqual([true, false]);

    setMode("empty");
    flush();
    expect(presence.at(-1)).toBe(false);

    setMode("plain");
    flush();
    expect(presence.at(-1)).toBe(true);
  });

  // The twin the diff uncovered (S4): a landing on an optimistic family
  // judges the container's arrangement guess whether or not anything
  // subscribes to the container. Here a newer question's rows land beneath
  // an optimistic push whose guessed keys (`2`, `length`, `2 in`) the truth
  // left as they were, and the reader subscribes to leaves only (index
  // reads — no `in`, no enumeration). Before, the unconditional presence
  // write was the one landing that reached the lane; with presence diffed,
  // only the container's judgement folds the landing into the retaining
  // action (A18: a differing truth supersedes the guess, held by the parent
  // for its commit — #2719/#3164's "the view keeps the old question plus the
  // optimism, the truth reveals at settle").
  it("a landing that changes no guessed key still judges the container's arrangement guess (leaf-only reader)", async () => {
    type Comment = { id: number; text: string };
    const serverComments: Comment[][] = [
      [
        { id: 0, text: "Issue 0 A" },
        { id: 1, text: "Issue 0 B" }
      ],
      [
        { id: 2, text: "Issue 1 A" },
        { id: 3, text: "Issue 1 B" }
      ]
    ];
    const fetches: Array<{ issueId: number; resolve: () => void }> = [];
    const rendered: (string | undefined)[][] = [];
    const settle = async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      flush();
    };
    let setIssue!: (issue: number) => number;
    let comments!: readonly Comment[];
    let setComments!: (fn: (comments: Comment[]) => void) => void;
    createRoot(() => {
      const [issueId, setIssueId] = createSignal(0);
      setIssue = setIssueId;
      [comments, setComments] = createOptimisticStore(
        () =>
          new Promise<Comment[]>(resolve => {
            const requestedIssue = issueId();
            fetches.push({
              issueId: requestedIssue,
              resolve: () => resolve(structuredClone(serverComments[requestedIssue]))
            });
          }),
        [] as Comment[]
      );
      createRenderEffect(
        () => {
          const out: (string | undefined)[] = [];
          for (let i = 0; i < comments.length; i++) out.push(comments[i]?.text);
          return out;
        },
        v => void rendered.push(v)
      );
    });
    flush();
    fetches.shift()!.resolve();
    await settle();
    expect(rendered.at(-1)).toEqual(["Issue 0 A", "Issue 0 B"]);

    const gate = deferred();
    const addComment = action(function* addComment() {
      setComments(draft => {
        draft.push({ id: -1, text: "Optimistic" });
      });
      yield gate.promise;
    });
    const add = addComment();
    flush();
    expect(rendered.at(-1)).toEqual(["Issue 0 A", "Issue 0 B", "Optimistic"]);

    const nextIssue = action(function* nextIssue() {
      setIssue(1);
      yield new Promise<void>(resolve => queueMicrotask(resolve));
    });
    const next = nextIssue();
    flush();
    fetches.find(fetch => fetch.issueId === 1)!.resolve();
    await next;
    await settle();
    // Mid-hold: the issue-1 truth is held by the retaining action — never
    // the new rows beside the old optimistic one.
    expect(rendered.at(-1)).toEqual(["Issue 0 A", "Issue 0 B", "Optimistic"]);

    gate.resolve();
    await add;
    await settle();
    expect(rendered.at(-1)).toEqual(["Issue 1 A", "Issue 1 B"]);
  });

  // The setter half of the same gate (`notifyWrites`): the derive writes
  // its draft imperatively — a store setter's exit, not a reconcile of a
  // returned value. An optimistic swap of rows `0` and `1` guesses those
  // two leaves and the container's arrangement; the derive then appends a
  // row at index `2` — `length` and `2` are its written keys, neither of
  // them guessed (an array index write cannot avoid `length`, so the guess
  // under test holds no `length`). The reader subscribes to leaves only,
  // so nothing subscribes to the container; the write is still a landing
  // on its arrangement guess, and judging it is what folds the newer
  // question's row into the retaining action (A18: a differing truth
  // supersedes the guess, held by the parent for its commit; the screen
  // keeps the guess until then). Were the container gated on subscribers
  // alone, the new row would publish beneath the swapped pair mid-hold.
  it("a setter that changes no guessed key still judges the container's arrangement guess (leaf-only reader)", async () => {
    type Comment = { id: number; text: string };
    const rendered: (string | undefined)[][] = [];
    const settle = async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      flush();
    };
    let setMore!: (more: boolean) => boolean;
    let comments!: readonly Comment[];
    let setComments!: (fn: (comments: Comment[]) => void) => void;
    createRoot(() => {
      const [more, setMoreComments] = createSignal(false);
      setMore = setMoreComments;
      [comments, setComments] = createOptimisticStore(
        draft => {
          // One row write at index `2`: never `0`, never `1`.
          if (more()) draft[2] = { id: 2, text: "C" };
        },
        [
          { id: 0, text: "A" },
          { id: 1, text: "B" }
        ] as Comment[]
      );
      createRenderEffect(
        () => {
          const out: (string | undefined)[] = [];
          for (let i = 0; i < comments.length; i++) out.push(comments[i]?.text);
          return out;
        },
        v => void rendered.push(v)
      );
    });
    flush();
    expect(rendered.at(-1)).toEqual(["A", "B"]);

    const gate = deferred();
    const swap = action(function* swap() {
      setComments(draft => {
        const [a, b] = [draft[0], draft[1]];
        draft[0] = b;
        draft[1] = a;
      });
      yield gate.promise;
    });
    const swapping = swap();
    flush();
    expect(rendered.at(-1)).toEqual(["B", "A"]);

    const loadMore = action(function* loadMore() {
      setMore(true);
      yield new Promise<void>(resolve => queueMicrotask(resolve));
    });
    const loading = loadMore();
    flush();
    await loading;
    await settle();
    // Mid-hold: the new row is held by the retaining action — never
    // beneath the swapped pair.
    expect(rendered.at(-1)).toEqual(["B", "A"]);

    gate.resolve();
    await swapping;
    await settle();
    expect(rendered.at(-1)).toEqual(["A", "B", "C"]);
  });

  // The setter path's open twin (#3743's comment thread): a mainline setter
  // mid-hold writes `a.value` and `b.value` while an action holds `b.flag`.
  // A34 (1): an explicit repeat of the held key is a proposal and joins; a
  // key the setter did NOT write is not — `a.value` publishes with the
  // mainline tick, `b.flag` stays held. Current L2 joins: the written keys
  // `notifyWrites` visits are `t.wk`, retained for the pending fold and
  // CUMULATIVE across the batch's setters, so the later setter re-notifies
  // the held `flag` node with its unchanged value and `setSignal` joins
  // before the equality gate (the write is a proposal). The fix direction is
  // per-setter written keys: the notify visits the keys THIS setter wrote,
  // the fold keeps the batch's union.
  it.fails(
    "a later mainline setter that does not write the held key publishes on the mainline tick",
    async () => {
      type State = { a: { value: number }; b: { value: number; flag: boolean } };
      const values: number[] = [];
      const flags: boolean[] = [];
      let state!: State;
      let setState!: (fn: (draft: State) => void) => void;
      createRoot(() => {
        [state, setState] = createStore<State>({ a: { value: 0 }, b: { value: 0, flag: true } });
        createRenderEffect(
          () => state.a.value,
          v => void values.push(v)
        );
        createRenderEffect(
          () => state.b.flag,
          v => void flags.push(v)
        );
      });
      flush();
      expect(values).toEqual([0]);
      expect(flags).toEqual([true]);

      const gate = deferred();
      const toggle = action(function* toggle() {
        setState(draft => {
          draft.b.flag = false;
        });
        yield gate.promise;
      });
      const run = toggle();
      flush();
      expect(flags).toEqual([true]);

      setState(draft => {
        draft.a.value = 1;
        draft.b.value = 1;
      });
      flush();
      // Spec: `a.value` is nobody's proposal — it publishes now; the held
      // key stays held.
      expect(values).toEqual([0, 1]);
      expect(flags).toEqual([true]);

      gate.resolve();
      await run;
      await Promise.resolve();
      flush();
      expect(values).toEqual([0, 1]);
      expect(flags).toEqual([true, false]);
    }
  );
});
