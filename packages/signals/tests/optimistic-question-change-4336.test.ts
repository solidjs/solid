/**
 * #4336: a guess made inside a pending action over the answer to one
 * question (`sel()` = 3) stays on screen after an outside change to the
 * question's input (`setSel(1)`) and that new question's answer lands: the
 * screen pairs `#1:` with issue 3's comments and the guess (F-1).
 *
 * These tests pin what the issue expects: no torn frame, the new question's
 * answer showing at its landing while the action is still out, and the
 * action's own `refresh()` re-asking issue 1 after it settles. The window
 * between `setSel(1)` and the landing is pinned as a held change (F-2: the
 * screen keeps what it showed) and as pending (F-9). The fix's direction is
 * open (#4336); these assertions may move with the ruling.
 *
 * Controls (pass on next): a `refresh()` re-ask of the same question keeps
 * the guess until the commit (D-34, #4329), and the guess's own action
 * changing the question keeps it too.
 */
import { describe, expect, it } from "vitest";
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
  refresh
} from "../src/index.js";

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
  return { p, res, rej };
};

type Comment = { id: string; text: string };
type Ask = { id: number; d: ReturnType<typeof defer<any>> };

/** The issue's graph. `form` picks the optimistic primitive; `effect` the
 * reader (the issue uses a user effect; a render effect is the screen). */
function setup(
  form: "signal" | "store-draft" | "store-return",
  effect: "user" | "render" = "user"
) {
  const asks: Ask[] = [];
  const frames: string[] = [];
  let server!: ReturnType<typeof defer<unknown>>;
  let setSel!: (v: number) => void;
  let post!: (text: string) => Promise<void>;
  let comments!: any;
  let view!: () => string;
  let guess!: (text: string) => void;
  createRoot(() => {
    const [sel, ss] = createSignal(3);
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
      view = () => c.map(r => r.text).join(" | ");
      guess = text =>
        set(d => {
          d.push({ id: `tmp-${text}`, text: `${text} (sending)` });
        });
    }
    (effect === "user" ? createEffect : createRenderEffect)(
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
    view,
    guess: (text: string) => guess(text),
    screen: () => frames[frames.length - 1]
  };
}

/** A frame headed by issue 1 that shows issue 3's comments or the guess. */
const torn = (frames: string[]) =>
  frames.filter(f => f.startsWith("#1:") && (f.includes("dana") || f.includes("sending")));

const forms = ["signal", "store-draft", "store-return"] as const;

for (const form of forms) {
  describe(`#4336 a guess over one question after the question changes (${form})`, () => {
    for (const effect of ["user", "render"] as const) {
      it(`the issue's repro: no frame pairs #1 with issue 3's comments (${effect} effect)`, async () => {
        const h = setup(form, effect);
        await tick();
        h.asks[0].d.res(["dana"]);
        await tick();
        expect(h.screen()).toBe("#3: dana");

        h.post("mine");
        await tick();
        expect(h.screen()).toBe("#3: dana | mine (sending)");

        // A new question from outside the action: the change holds on issue
        // 1's answer; the screen keeps what it showed (F-2).
        h.setSel(1);
        await tick();
        expect(h.asks.at(-1)!.id).toBe(1);
        expect(h.screen()).toBe("#3: dana | mine (sending)");

        // Issue 1's answer lands while the action is still out: it shows.
        h.asks.at(-1)!.d.res([]);
        await tick();
        expect(h.screen()).toBe("#1: ");

        // The action settles; its refresh re-asks issue 1 and lands.
        h.server.res({});
        await tick();
        expect(h.asks.at(-1)!.id).toBe(1);
        h.asks.at(-1)!.d.res(["mine"]);
        await tick();
        expect(h.screen()).toBe("#1: mine");
        expect(torn(h.frames)).toEqual([]);
      });
    }

    it("isPending and latest during the window (F-9, F-11, D-22)", async () => {
      const h = setup(form);
      await tick();
      h.asks[0].d.res(["dana"]);
      await tick();
      h.post("mine");
      await tick();
      const read = () => (form === "signal" ? h.comments() : h.comments.map((r: any) => r.text));
      // An optimistic value is verdict-inert.
      expect(isPending(h.comments)).toBe(false);

      h.setSel(1);
      await tick();
      // A new question is in flight: pending. Nothing newer than what the
      // screen shows exists yet, and untracked reads see the screen.
      expect(isPending(h.comments)).toBe(true);
      expect(read()).toEqual(["dana", "mine (sending)"]);
      expect(latest(read)).toEqual(["dana", "mine (sending)"]);

      h.asks.at(-1)!.d.res([]);
      await tick();
      // The answer to the new question is final: no guess covers it.
      expect(isPending(h.comments)).toBe(false);
      expect(read()).toEqual([]);
      expect(latest(read)).toEqual([]);

      // The action's own re-ask of the same question is quiet (F-9).
      h.server.res({});
      await tick();
      expect(isPending(h.comments)).toBe(false);
      h.asks.at(-1)!.d.res(["mine"]);
      await tick();
      expect(isPending(h.comments)).toBe(false);
      expect(read()).toEqual(["mine"]);
      expect(h.screen()).toBe("#1: mine");
    });

    // The screen is a render effect: a user effect's compute is a
    // derivation, which re-derives from a different truth now (D-34).
    it("control: a refresh() re-ask of the same question keeps the guess until the commit (D-34, #4329)", async () => {
      const h = setup(form, "render");
      await tick();
      h.asks[0].d.res(["dana"]);
      await tick();
      h.post("mine");
      await tick();

      refresh(h.comments);
      await tick();
      expect(h.asks.at(-1)!.id).toBe(3);
      expect(h.screen()).toBe("#3: dana | mine (sending)");
      expect(isPending(h.comments)).toBe(false);
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
      const h = setup(form, "render");
      // A reader of the comments alone: the guess's own world.
      const shown: string[] = [];
      createRoot(() => createRenderEffect(h.view, v => void shown.push(v)));
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
      expect(shown.at(-1)).toBe("dana | mine (sending)");

      go.res();
      await tick();
      expect(h.asks.at(-1)!.id).toBe(1);
      h.asks.at(-1)!.d.res([]);
      await tick();
      // The action's own question: a different truth corrects at the commit.
      expect(shown.at(-1)).toBe("dana | mine (sending)");
      done.res();
      await tick();
      expect(shown.at(-1)).toBe("");
      expect(h.screen()).toBe("#1: ");
    });
  });
}
