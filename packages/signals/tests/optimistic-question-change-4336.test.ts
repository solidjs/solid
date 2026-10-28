/**
 * #4336: a guess made inside a pending action over the answer to one
 * question (`sel()` = 3), then an outside change to the question's input
 * (`setSel(1)`). Ruled 2026-10-28: hold. The guess's node re-asks because an
 * input changed outside the guess's own action, so the input change is held
 * with that action (D-34): the screen keeps `#3: dana | mine (sending)` until
 * the post settles, then shows issue 1's comments. No frame shows the new
 * `sel` beside comments derived from the old one (F-1), however the reads
 * are grouped into render effects (#4284). `isPending` is true while the new
 * question is in flight or held (F-9); `latest()` answers the newest truth
 * (F-6). An input set through its own optimistic write shows at once, in
 * its own lane (F-6, F-11).
 *
 * Controls: a `refresh()` re-ask of the same question keeps the guess until
 * the commit (D-34, #4329); the guess's own action changing the question
 * keeps it too; a keyed store whose new question writes another key does not
 * wait for the post.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  action,
  createEffect,
  createOptimistic,
  createOptimisticStore,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  isPending,
  latest,
  refresh,
  resetErrorHalt
} from "../src/index.js";

/** Every gate a test opened: settled after it, so an action a failing test
 * left open does not hold the next test's frames. */
const gates: Array<() => void> = [];
afterEach(async () => {
  for (let g; (g = gates.pop()); ) g();
  await tick();
  resetErrorHalt();
  flush();
});

const tick = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};
const defer = <T = void>() => {
  let res!: (v: T) => void;
  let rej!: (e: unknown) => void;
  const p = new Promise<T>((a, b) => {
    res = a;
    rej = b;
  });
  gates.push(() => res([] as T));
  return { p, res, rej };
};

type Comment = { id: string; text: string };
type Ask = { id: number; d: ReturnType<typeof defer<any>> };
type Form = "signal" | "store-draft" | "store-return";

/** The issue's graph. `form` picks the optimistic primitive; `reader` the
 * screen: one render effect reading both, a user effect (the issue's), or
 * two render effects (`#sel` and the comments, recorded as one frame each
 * time either applies). `optimisticSel`: `sel` is itself a
 * `createOptimistic`, set inside its own action. */
function setup(form: Form, reader: "render" | "user" | "split" = "render", optimisticSel = false) {
  const asks: Ask[] = [];
  const frames: string[] = [];
  let server!: ReturnType<typeof defer<unknown>>;
  let setSel!: (v: number) => void;
  let post!: (text: string) => Promise<void>;
  let comments!: any;
  let sel!: () => number;
  let view!: () => string;
  let guess!: (text: string) => void;
  createRoot(() => {
    const [s, ss] = optimisticSel ? createOptimistic(3) : createSignal(3);
    sel = s;
    setSel = ss;
    const ask = () => {
      const id = sel();
      const d = defer<any>();
      asks.push({ id, d });
      return d.p;
    };
    if (form === "signal") {
      const [c, set] = createOptimistic<string[]>(async () => ask());
      comments = c;
      view = () => c().join(" | ");
      guess = text => set(v => [...v, `${text} (sending)`]);
    } else {
      const [c, set] = createOptimisticStore<Comment[]>(async d => {
        const rows: string[] = await ask();
        const list = rows.map(text => ({ id: text, text }));
        if (form === "store-return") return list;
        d.length = 0;
        d.push(...list);
      }, []);
      comments = c;
      // A hole (a row missing beside the length) shows as `<hole>`.
      view = () => c.map(r => r?.text ?? "<hole>").join(" | ");
      guess = text =>
        set(d => {
          d.push({ id: `tmp-${text}`, text: `${text} (sending)` });
        });
    }
    if (reader === "split") {
      // One frame per flush: both effects' latest values, sampled once the
      // flush that applied them is over.
      let a = "";
      let b = "";
      let queued = false;
      const sample = () => {
        if (queued) return;
        queued = true;
        queueMicrotask(() => {
          queued = false;
          frames.push(`${a} ${b}`);
        });
      };
      createRenderEffect(
        () => `#${sel()}:`,
        v => ((a = v), sample())
      );
      createRenderEffect(view, v => ((b = v), sample()));
    } else
      (reader === "user" ? createEffect : createRenderEffect)(
        () => `#${sel()}: ${view()}`,
        (v: string) => void frames.push(v)
      );
    post = action(function* (text: string) {
      guess(text);
      server = defer();
      try {
        yield server.p;
        refresh(comments);
      } catch (e) {}
    });
  });
  const read = (): string[] => (form === "signal" ? comments() : comments.map((r: any) => r.text));
  return {
    asks,
    frames,
    setSel,
    post,
    get comments() {
      return comments;
    },
    get server() {
      return server;
    },
    sel: () => sel(),
    view,
    read,
    guess: (text: string) => guess(text),
    screen: () => frames[frames.length - 1]
  };
}

/** A frame headed by issue 1 that shows issue 3's comments or the guess. */
const torn = (frames: string[]) =>
  frames.filter(
    f =>
      f.includes("<hole>") || (f.startsWith("#1:") && (f.includes("dana") || f.includes("sending")))
  );

async function primed(form: Form, reader?: "render" | "user" | "split", optimisticSel?: boolean) {
  const h = setup(form, reader, optimisticSel);
  await tick();
  h.asks[0].d.res(["dana"]);
  await tick();
  expect(h.screen()).toBe("#3: dana");
  h.post("mine");
  await tick();
  expect(h.screen()).toBe("#3: dana | mine (sending)");
  return h;
}

const forms = ["signal", "store-draft", "store-return"] as const;

for (const form of forms) {
  describe(`#4336 the question changes under a guess: hold (${form})`, () => {
    for (const reader of ["render", "split"] as const)
      it(`the issue's repro: the input change waits for the post (${reader})`, async () => {
        const h = await primed(form, reader);

        // A new question from outside the action: held with the post.
        h.setSel(1);
        await tick();
        expect(h.asks.at(-1)!.id).toBe(1);
        expect(h.screen()).toBe("#3: dana | mine (sending)");

        // Issue 1's answer lands while the post is out: still held.
        h.asks.at(-1)!.d.res([]);
        await tick();
        expect(h.screen()).toBe("#3: dana | mine (sending)");

        // The post settles; its refresh re-asks issue 1; the landing reveals.
        h.server.res({});
        await tick();
        expect(h.screen()).toBe("#3: dana | mine (sending)");
        expect(h.asks.at(-1)!.id).toBe(1);
        h.asks.at(-1)!.d.res(["mine"]);
        await tick();
        expect(h.screen()).toBe("#1: mine");
        expect(torn(h.frames)).toEqual([]);
      });

    // The issue's reader. A user effect is a derivation, not the screen: it
    // may see the hold's world before the commit (D-34), but never a torn one.
    it("the issue's repro with a user effect: never torn", async () => {
      const h = await primed(form, "user");
      h.setSel(1);
      await tick();
      h.asks.at(-1)!.d.res([]);
      await tick();
      h.server.res({});
      await tick();
      h.asks.at(-1)!.d.res(["mine"]);
      await tick();
      expect(h.screen()).toBe("#1: mine");
      expect(torn(h.frames)).toEqual([]);
    });

    it("isPending is true while the new question is in flight or held; latest answers the newest truth (F-9, F-6)", async () => {
      const h = await primed(form);
      // An optimistic value is verdict-inert.
      expect(isPending(h.read)).toBe(false);

      h.setSel(1);
      await tick();
      expect(isPending(h.read)).toBe(true);
      expect(latest(h.sel)).toBe(1);

      h.asks.at(-1)!.d.res([]);
      await tick();
      expect(isPending(h.read)).toBe(true);
      expect(latest(h.read)).toEqual([]);
      // Untracked reads see the screen (D-34).
      expect(h.read()).toEqual(["dana", "mine (sending)"]);

      h.server.res({});
      await tick();
      expect(isPending(h.read)).toBe(true);
      h.asks.at(-1)!.d.res(["mine"]);
      await tick();
      expect(isPending(h.read)).toBe(false);
      expect(h.read()).toEqual(["mine"]);
      expect(latest(h.read)).toEqual(["mine"]);
      expect(h.screen()).toBe("#1: mine");
    });

    // OPEN (fails on next and with the #4336 fix): the input's guess opens
    // a lane whose own work re-asks the comments; the post's guess on the
    // comments node stands in for that flight in the input's lane
    // (`laneStage` lists the guessed node in the re-asking lane), so the lane
    // shows `#1:` beside issue 3's comments and the post's guess at once.
    // A node carries one lane value; the input's lane has no slot of its own
    // for the new question's answer.
    it.fails(
      "an input set through its own optimistic write shows without waiting for the post (F-6, F-11)",
      async () => {
        const h = await primed(form, "render", true);
        const go = defer();
        action(function* () {
          h.setSel(1);
          yield go.p;
        })();
        await tick();
        expect(h.asks.at(-1)!.id).toBe(1);
        // The guess's own lane waits on the comments it derives (F-6).
        h.asks.at(-1)!.d.res([]);
        await tick();
        expect(h.screen()).toBe("#1: ");
        go.res();
        await tick();
        expect(h.screen()).toBe("#1: ");
        h.server.res({});
        await tick();
        h.asks.at(-1)!.d.res(["mine"]);
        await tick();
        expect(h.screen()).toBe("#1: mine");
        expect(torn(h.frames)).toEqual([]);
      }
    );

    it("control: a refresh() re-ask of the same question keeps the guess until the commit (D-34, #4329)", async () => {
      const h = await primed(form);
      refresh(h.comments);
      await tick();
      expect(h.asks.at(-1)!.id).toBe(3);
      expect(h.screen()).toBe("#3: dana | mine (sending)");
      expect(isPending(h.read)).toBe(false);
      h.asks.at(-1)!.d.res(["dana"]);
      await tick();
      expect(h.screen()).toBe("#3: dana | mine (sending)");

      h.server.res({});
      await tick();
      expect(h.screen()).toBe("#3: dana | mine (sending)");
      h.asks.at(-1)!.d.res(["dana", "mine"]);
      await tick();
      expect(h.screen()).toBe("#3: dana | mine");
      expect(h.frames.slice(1)).not.toContain("#3: dana");
    });

    it("control: the guess's own action changing the question keeps the guess until its commit (D-34)", async () => {
      const h = setup(form);
      await tick();
      h.asks[0].d.res(["dana"]);
      await tick();
      const go = defer();
      const done = defer();
      action(function* () {
        h.guess("mine");
        yield go.p;
        h.setSel(1);
        yield done.p;
      })();
      await tick();
      expect(h.screen()).toBe("#3: dana | mine (sending)");

      go.res();
      await tick();
      expect(h.asks.at(-1)!.id).toBe(1);
      expect(h.screen()).toBe("#3: dana | mine (sending)");
      h.asks.at(-1)!.d.res([]);
      await tick();
      // The action's own question: a different truth corrects at the commit.
      expect(h.screen()).toBe("#3: dana | mine (sending)");
      done.res();
      await tick();
      expect(h.screen()).toBe("#1: ");
      expect(torn(h.frames)).toEqual([]);
    });
  });
}

describe("#4336 keyed store: a new question that writes another key", () => {
  // Passes on next. OPEN with the #4336 fix: a store's derive is one node
  // asking one question for every key, so an input change outside the post
  // re-asks the node the post's guess (on key 3) lies over, and the change
  // is held with the post — `#1:` shows when the post settles. Which keys
  // the new answer writes is known only when it lands.
  it.fails("does not wait for the post; switching back shows the guess", async () => {
    const asks: Ask[] = [];
    const frames: string[] = [];
    let server!: ReturnType<typeof defer<unknown>>;
    let setSel!: (v: number) => void;
    let post!: () => Promise<void>;
    createRoot(() => {
      const [sel, ss] = createSignal(3);
      setSel = ss;
      const [comments, set] = createOptimisticStore<Record<number, string[]>>(async d => {
        const id = sel();
        const p = defer<string[]>();
        asks.push({ id, d: p });
        const rows = await p.p;
        d[id] = rows;
      }, {});
      createRenderEffect(
        () => `#${sel()}: ${(comments[sel()] ?? []).join(" | ")}`,
        v => void frames.push(v)
      );
      post = action(function* () {
        set(d => {
          d[3].push("mine (sending)");
        });
        server = defer();
        yield server.p;
        refresh(comments);
      });
    });
    await tick();
    asks[0].d.res(["dana"]);
    await tick();
    expect(frames.at(-1)).toBe("#3: dana");
    post();
    await tick();
    expect(frames.at(-1)).toBe("#3: dana | mine (sending)");

    setSel(1);
    await tick();
    expect(asks.at(-1)!.id).toBe(1);
    asks.at(-1)!.d.res([]);
    await tick();
    // `sel` may wait for issue 1's answer, but not for the post.
    expect(frames.at(-1)).toBe("#1: ");

    setSel(3);
    await tick();
    if (asks.at(-1)!.id === 3) {
      asks.at(-1)!.d.res(["dana"]);
      await tick();
    }
    expect(frames.at(-1)).toBe("#3: dana | mine (sending)");

    server.res({});
    await tick();
    expect(asks.at(-1)!.id).toBe(3);
    asks.at(-1)!.d.res(["dana", "mine"]);
    await tick();
    expect(frames.at(-1)).toBe("#3: dana | mine");
    expect(torn(frames)).toEqual([]);
    expect(frames.filter(f => f.startsWith("#3:") && f.includes("sending"))).not.toContain(
      "#3: dana"
    );
  });
});
