/**
 * #4690: an action guesses, yields its write, then `refresh()`es the guessed
 * source. A `refresh()` of that source from outside the action lands while
 * the guess is pending: the same question, so it holds nothing new, and its
 * answer corrects the graph now and the screen at the commit (D-34). The
 * hold the guess was made over is the action's, open until its body has
 * returned and everything it put in flight has landed — its own `refresh()`
 * included (D-7, D-31) — so the guess is the slot's value for the screen and
 * for untracked reads until that refresh lands (F-11, D-33; S-44 row 1′:
 * "until the post commits"). The write landing ends the body, but the
 * action's refresh is authoritative and in flight, so the body's end
 * corrects nothing (D-35). Never the old truth between the write and the
 * refresh — with the outside re-ask exactly as without it (the control).
 *
 * The corrected guess no longer kept its hold open on its own flight, as an
 * uncorrected guess does (lanes.ts `guessFlights`): with no render effect
 * pending on the refresh, the hold landed at the body's end and effects and
 * untracked reads saw the old truth until the refresh's own landing, while a
 * rendered reader — a render effect, a text node under `<Loading>`, and an
 * effect beside it — kept the guess: a tear between effect-only readers and
 * rendered ones, not a flicker a rendered app shows. The corrected guess
 * now keeps its hold open on its flight (lanes.ts `marked`, `lanesBlocked`)
 * — for its own hold only, never a lane that guesses it again, and never
 * past that hold's landing (the last two blocks). The unkeyed array store
 * writes the answer into its rows; a derive that replaces the row objects
 * instead is outside this file.
 */
import { describe, expect, it } from "vitest";
import {
  action,
  createOptimistic,
  createEffect,
  createLoadingBoundary,
  createOptimisticStore,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  refresh,
  untrack
} from "../src/index.js";

const tick = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

function asks() {
  const list: { key: string; res: (v: any) => void }[] = [];
  const ask = (key: string) => new Promise<any>(res => list.push({ key, res }));
  const land = async (key: string, v: any) => {
    const i = list.findIndex(a => a.key === key);
    expect(i).toBeGreaterThan(-1);
    list.splice(i, 1)[0].res(v);
    await tick();
  };
  return { ask, land, list };
}

// The readers of #4690's corrected scope: effects or untracked reads alone
// saw the old truth between the write and the action's refresh; a text node
// under `<Loading>` kept the guess, and so did an effect beside it. Every one
// shows the guess throughout (F-1: one world for every channel).
const readers = [
  "untracked reads only",
  "an effect only",
  "a render effect",
  "a text node under <Loading>",
  "an effect beside a text node under <Loading>"
] as const;
type Reader = (typeof readers)[number];

function harness(read: () => string, reader: Reader) {
  // Each reader's values, in the order it showed them.
  const channels: string[][] = [];
  const channel = () => {
    const runs: string[] = [];
    channels.push(runs);
    return runs;
  };
  if (reader === "an effect only" || reader === "an effect beside a text node under <Loading>") {
    const runs = channel();
    createEffect(read, v => void runs.push(v));
  }
  if (reader === "a render effect") {
    const runs = channel();
    createRenderEffect(read, v => void runs.push(v));
  }
  if (reader.includes("<Loading>")) {
    // The screen: the fallback, or the text node's value once content shows.
    const runs = channel();
    let content = false;
    let text = "";
    const b = createLoadingBoundary(
      () => {
        createRenderEffect(read, v => {
          text = v;
          if (content) runs.push(v);
        });
        return "content";
      },
      () => "fallback"
    );
    createRenderEffect(b, v => {
      content = v === "content";
      runs.push(content ? text : v);
    });
  }
  const last = (runs: string[]) => runs[runs.length - 1] ?? null;
  return {
    // What every reader shows now, then the slot's untracked value.
    shows: () => [...channels.map(last), untrack(read)],
    // The distinct values each reader showed, in order.
    histories: () => channels.map(runs => runs.filter((v, i) => v !== runs[i - 1]))
  };
}

function signalForm(reader: Reader) {
  const { ask, land, list } = asks();
  let h!: ReturnType<typeof harness>;
  let rename!: (title: string) => any;
  let reask!: () => void;
  createRoot(() => {
    const [truth] = createSignal<{ title: string }>(async () => ({ ...(await ask("fetch")) }));
    const [detail, setGuess] = createOptimistic(() => truth());
    h = harness(() => detail().title, reader);
    rename = action(function* (title: string) {
      setGuess(d => ({ ...d, title }));
      yield ask("rename");
      refresh(truth);
    });
    reask = () => refresh(truth);
  });
  return { land, list, h, rename: (t: string) => rename(t), reask: () => reask() };
}

function storeForm(reader: Reader, key: "id" | null) {
  const { ask, land, list } = asks();
  let h!: ReturnType<typeof harness>;
  let rename!: (title: string) => any;
  let reask!: () => void;
  createRoot(() => {
    const [issues, setIssues] = createOptimisticStore<{ id: number; title: string }[]>(
      async d => {
        const r = await ask("fetch");
        d.length = r.length;
        // Unkeyed rows have no identity to match by: the derive writes the
        // answer into the rows it has, as an index-by-index merge does.
        r.forEach((x: any, i: number) => {
          if (key === null && d[i]) Object.assign(d[i], x);
          else d[i] = { ...x };
        });
      },
      [],
      { key }
    );
    h = harness(() => issues.map(i => i.title).join(","), reader);
    rename = action(function* (title: string) {
      setIssues(d => {
        d[0].title = title;
      });
      yield ask("rename");
      refresh(issues);
    });
    reask = () => refresh(issues);
  });
  return { land, list, h, rename: (t: string) => rename(t), reask: () => reask() };
}

function objectStoreForm(reader: Reader) {
  const { ask, land, list } = asks();
  let h!: ReturnType<typeof harness>;
  let rename!: (title: string) => any;
  let reask!: () => void;
  createRoot(() => {
    const [detail, setDetail] = createOptimisticStore<{ title?: string }>(async d => {
      d.title = (await ask("fetch")).title;
    }, {});
    h = harness(() => detail.title!, reader);
    rename = action(function* (title: string) {
      setDetail(d => {
        d.title = title;
      });
      yield ask("rename");
      refresh(detail);
    });
    reask = () => refresh(detail);
  });
  return { land, list, h, rename: (t: string) => rename(t), reask: () => reask() };
}

const rows = (title: string) => [
  { id: 1, title },
  { id: 2, title: "Other" }
];
const forms = {
  "createOptimistic over createSignal(async)": {
    make: signalForm,
    answer: (title: string) => ({ title }),
    show: (t: string) => t
  },
  "keyed createOptimisticStore": {
    make: (r: Reader) => storeForm(r, "id"),
    answer: rows,
    show: (t: string) => `${t},Other`
  },
  "unkeyed array createOptimisticStore": {
    make: (r: Reader) => storeForm(r, null),
    answer: rows,
    show: (t: string) => `${t},Other`
  },
  "object createOptimisticStore": {
    make: objectStoreForm,
    answer: (title: string) => ({ title }),
    show: (t: string) => t
  }
};

for (const [name, f] of Object.entries(forms))
  for (const reader of readers)
    describe(`#4690 the guess stays until the action's own refresh lands (${name}, ${reader})`, () => {
      for (const outside of [true, false])
        it(`${outside ? "an outside re-ask landed under the guess" : "control: no outside re-ask"} (F-1, F-11, D-7, D-33, D-34, S-44 1′)`, async () => {
          const t = f.make(reader);
          const all = (title: string) => t.h.shows().map(() => f.show(title));
          flush();
          await tick();
          await t.land("fetch", f.answer("Old bug"));
          expect(t.h.shows()).toEqual(all("Old bug"));

          t.rename("Bravo");
          await tick();
          expect(t.h.shows()).toEqual(all("Bravo"));

          if (outside) {
            t.reask();
            await tick();
            await t.land("fetch", f.answer("Old bug"));
            // The answer differs from the guess: every reader keeps the
            // guess until the hold commits (D-34).
            expect(t.h.shows()).toEqual(all("Bravo"));
          }

          await t.land("rename", undefined);
          // The action's refresh is in flight: its hold is still open.
          expect(t.list.map(a => a.key)).toEqual(["fetch"]);
          expect(t.h.shows()).toEqual(all("Bravo"));

          await t.land("fetch", f.answer("Bravo"));
          expect(t.h.shows()).toEqual(all("Bravo"));
          // No reader ever showed the old truth after the guess.
          for (const history of t.h.histories())
            expect(history.filter(v => v !== "fallback")).toEqual([
              f.show("Old bug"),
              f.show("Bravo")
            ]);
        });
    });

describe("#4690 a second guess in the corrected guess's lane", () => {
  // One action guesses two slots (one lane); the outside re-ask corrects the
  // first, which dissolves the lane: the second is the hold's to land, and
  // its own refresh, asked by the action, keeps that hold open as it did
  // while the lane stood (D-33: both live as long as the hold).
  for (const outside of [true, false])
    it(`${outside ? "an outside re-ask corrected the other guess" : "control: no outside re-ask"} (F-11, D-7, D-33)`, async () => {
      const { ask, land, list } = asks();
      let a!: () => { v: string }, b!: () => { v: string };
      let run!: () => any, reaskA!: () => void;
      createRoot(() => {
        const [truthA] = createSignal(async () => ({ v: await ask("A") }));
        const [truthB] = createSignal(async () => ({ v: await ask("B") }));
        let setA!: (v: { v: string }) => void, setB!: (v: { v: string }) => void;
        [a, setA] = createOptimistic(() => truthA());
        [b, setB] = createOptimistic(() => truthB());
        run = action(function* () {
          setA({ v: "a2" });
          setB({ v: "b2" });
          yield ask("save");
          refresh(truthB);
        });
        reaskA = () => refresh(truthA);
      });
      const shows = () => `${untrack(a).v} ${untrack(b).v}`;
      flush();
      await tick();
      await land("A", "a1");
      await land("B", "b1");
      expect(shows()).toBe("a1 b1");
      run();
      await tick();
      expect(shows()).toBe("a2 b2");
      if (outside) {
        reaskA();
        await tick();
        await land("A", "a1");
        expect(shows()).toBe("a2 b2");
      }
      await land("save", undefined);
      expect(list.map(x => x.key)).toEqual(["B"]);
      expect(shows()).toBe("a2 b2");
      await land("B", "b2");
      // The hold commits: `a`'s truth (the re-ask's, or the value it
      // covered), `b`'s refresh.
      expect(shows()).toBe("a1 b2");
    });
});

describe("#4690 the corrected guess holds only its own hold", () => {
  // The hold the corrected guess kept open has landed: a later action that
  // re-asks the source, with no guess and no reader, is judged exactly as on
  // a node never guessed (F-11: the guess does not outlive its hold, D-33).
  // A settled guess's final landing is itself a correction when it is a new
  // object (supersede), so the control without the outside re-ask counts too.
  async function laterAction(history: "outside re-ask" | "control" | "never guessed") {
    const { ask, land } = asks();
    let detail!: () => { title: string }, x!: () => number;
    let rename!: (t: string) => any, later!: () => any, reask!: () => void;
    createRoot(() => {
      const [truth] = createSignal(async () => ({ ...(await ask("fetch")) }));
      let setGuess!: (fn: (d: { title: string }) => { title: string }) => void;
      [detail, setGuess] = createOptimistic(() => truth());
      let setX!: (v: number) => void;
      [x, setX] = createSignal(0);
      rename = action(function* (title: string) {
        setGuess(d => ({ ...d, title }));
        yield ask("rename");
        refresh(truth);
      });
      later = action(function* () {
        refresh(truth);
        yield ask("other");
        setX(1);
      });
      reask = () => refresh(truth);
    });
    flush();
    await tick();
    await land("fetch", { title: "Old bug" });
    if (history !== "never guessed") {
      rename("Bravo");
      await tick();
      if (history === "outside re-ask") {
        reask();
        await tick();
        await land("fetch", { title: "Old bug" });
      }
      await land("rename", undefined);
      await land("fetch", { title: "Bravo" });
      expect(untrack(detail).title).toBe("Bravo");
    }
    later();
    await tick();
    await land("other", undefined);
    const atBodyEnd = untrack(x);
    await land("fetch", { title: "Charlie" });
    return [atBodyEnd, untrack(x), untrack(detail).title];
  }

  for (const history of ["outside re-ask", "control"] as const)
    it(`a later action's refresh after the hold landed (${history}; F-11, D-33)`, async () => {
      expect(await laterAction(history)).toEqual(await laterAction("never guessed"));
    });
});

describe("#4690 a new guess over the corrected guess", () => {
  // The corrected guess's flight holds its hold, not a lane: a second rename
  // guessing the slot again while the source is re-asked shows now, as any
  // guess over a flight does (F-6, F-11; A17: the guess stands in for the
  // flight) — the hold waits, the screen does not.
  it("shows at once while the source is in flight (F-6, F-11)", async () => {
    const { ask, land } = asks();
    const frames: string[] = [];
    let rename!: (t: string) => any, reask!: () => void;
    createRoot(() => {
      const [truth] = createSignal(async () => ({ ...(await ask("fetch")) }));
      const [detail, setGuess] = createOptimistic(() => truth());
      createRenderEffect(
        () => detail().title,
        v => void frames.push(v)
      );
      rename = action(function* (title: string) {
        setGuess(d => ({ ...d, title }));
        yield ask(`rename ${title}`);
        refresh(truth);
      });
      reask = () => refresh(truth);
    });
    flush();
    await tick();
    await land("fetch", { title: "Old bug" });
    rename("Bravo");
    await tick();
    reask();
    await tick();
    await land("fetch", { title: "Old bug" });
    reask();
    await tick();
    rename("Charlie");
    await tick();
    expect(frames).toEqual(["Old bug", "Bravo", "Charlie"]);
  });
});
