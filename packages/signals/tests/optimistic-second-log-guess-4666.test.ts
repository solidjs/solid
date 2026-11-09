/**
 * #4666: #4629's shape with the second guess written into a different
 * `createOptimistic` log. Action 1 (assign) is accepted and its
 * `refresh(server)` is in flight when action 2 (close) guesses into a second
 * log that the same memo reads.
 *
 * F-11: a guess shows at once. The second log is not derived from the
 * re-asked list, so nothing holds it (F-6); the list is read in lane work at
 * the screen's value (D-26), and action 1's re-ask is a `refresh()`, which
 * re-asks the same question and holds nothing new (D-34 ¶3). The two logs are
 * separate slots, so each reverts with its own action (D-33), and the close
 * action is out until its own refresh lands (D-35).
 */
import { describe, expect, it } from "vitest";
import {
  action,
  createMemo,
  createOptimistic,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  refresh
} from "../src/index.js";

type Row = { id: number; who?: string };

const tick = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

type Read = "serverFirst" | "guessFirst" | "viaMemo";

function run(sameLog = false, read: Read = "serverFirst", ids = [1, 3]) {
  const asks: { key: string; res: (v: any) => void; rej: (e: any) => void }[] = [];
  const ask = (key: string) => new Promise<any>((res, rej) => asks.push({ key, res, rej }));
  const settle = async (key: string, fail = false) => {
    const i = asks.findIndex(a => a.key === key);
    expect(i, key).toBeGreaterThan(-1);
    const a = asks.splice(i, 1)[0];
    fail ? a.rej(new Error("no")) : a.res({});
    await tick();
  };
  let serverRows: Row[] = ids.map(id => ({ id }));
  const frames: string[] = [];
  let assign!: (id: number) => any;
  let close!: (id: number) => any;
  createRoot(() => {
    const server = createMemo<Row[]>(() =>
      ask("fetch").then(() => serverRows.map(r => ({ ...r })))
    );
    const [assignTruth] = createSignal<number[]>(() => []);
    const [assigning, guessAssign] = createOptimistic<number[]>(() => assignTruth());
    const [closeTruth] = createSignal<number[]>(() => []);
    const [closingLog, guessCloseLog] = createOptimistic<number[]>(() => closeTruth());
    // Same-log control: close guesses are written into `assigning` as -id.
    const closingRaw = sameLog
      ? () =>
          assigning()
            .filter(x => x < 0)
            .map(x => -x)
      : closingLog;
    // The second log read straight, or through a memo derived from it (the
    // held pass is then a grandchild of the guessed node).
    const closingMemo = createMemo(() => closingRaw());
    const closing = read === "viaMemo" ? closingMemo : closingRaw;
    const guessClose = sameLog
      ? (id: number) => guessAssign(xs => [...xs, -id])
      : (id: number) => guessCloseLog(xs => [...xs, id]);
    const shown = createMemo(() =>
      (read === "guessFirst" && closing(), server())
        .filter(r => !closing().includes(r.id))
        .map(r => `#${r.id}(${assigning().includes(r.id) ? "guest" : (r.who ?? "-")})`)
        .join(" ")
    );
    createRenderEffect(
      () => shown(),
      v => void frames.push(v)
    );
    assign = action(function* (id: number) {
      guessAssign(xs => [...xs, id]);
      try {
        yield ask(`assign:${id}`);
      } catch {
        return;
      }
      serverRows = serverRows.map(r => (r.id === id ? { ...r, who: "guest" } : r));
      refresh(server);
    });
    close = action(function* (id: number) {
      guessClose(id);
      try {
        yield ask(`close:${id}`);
      } catch {
        return;
      }
      serverRows = serverRows.filter(r => r.id !== id);
      refresh(server);
    });
  });
  return {
    get screen() {
      return frames[frames.length - 1];
    },
    frames,
    settle,
    asks,
    assign: (id: number) => assign(id),
    close: (id: number) => close(id),
    // Another tab adds a row: the next answer differs from the screen's.
    add: (id: number) => void (serverRows = [...serverRows, { id }])
  };
}

async function start(sameLog = false, read?: Read) {
  const t = run(sameLog, read);
  flush();
  await tick();
  await t.settle("fetch");
  expect(t.screen).toBe("#1(-) #3(-)");
  return t;
}

describe("#4666: a guess into a second log beside another action's refresh", () => {
  for (const sameLog of [false, true])
    for (const read of ["serverFirst", "guessFirst", "viaMemo"] as const)
      it(`${sameLog ? "same log (control)" : "second log"}, ${read}: close's guess shows at once`, async () => {
        const t = await start(sameLog, read);
        t.assign(3);
        await tick();
        expect(t.screen, "assign #3 guessed").toBe("#1(-) #3(guest)");
        await t.settle("assign:3");
        expect(t.screen, "assign accepted, refresh in flight").toBe("#1(-) #3(guest)");
        t.close(3);
        await tick();
        expect(t.screen, "close #3 guessed").toBe("#1(-)");
        await t.settle("close:3");
        expect(t.screen, "close accepted, its refresh in flight").toBe("#1(-)");
        while (t.asks.some(a => a.key === "fetch")) await t.settle("fetch");
        expect(t.screen, "every refresh landed").toBe("#1(-)");
        expect(t.frames.slice(1)).not.toContain("#1(-) #3(-)");
      });

  it("other order: close's refresh in flight, then assign guesses into the other log", async () => {
    const t = await start();
    t.close(1);
    await tick();
    expect(t.screen, "close #1 guessed").toBe("#3(-)");
    await t.settle("close:1");
    expect(t.screen, "close accepted, refresh in flight").toBe("#3(-)");
    t.assign(3);
    await tick();
    expect(t.screen, "assign #3 guessed").toBe("#3(guest)");
    await t.settle("assign:3");
    expect(t.screen, "assign accepted").toBe("#3(guest)");
    while (t.asks.some(a => a.key === "fetch")) await t.settle("fetch");
    expect(t.screen, "every refresh landed").toBe("#3(guest)");
  });

  // D-33: disjoint slots settle independently. Action 1's refresh landing
  // commits its frame while action 2 is still out: the screen shows the new
  // answer at once, under action 2's guess (F-11).
  for (const read of ["serverFirst", "guessFirst", "viaMemo"] as const)
    it(`second log, ${read}: action 1's refresh lands under action 2's guess`, async () => {
      const t = await start(false, read);
      t.assign(3);
      await tick();
      await t.settle("assign:3");
      t.add(5);
      t.close(3);
      await tick();
      expect(t.screen, "close #3 guessed").toBe("#1(-)");
      await t.settle("fetch");
      expect(t.screen, "assign's refresh landed, close out").toBe("#1(-) #5(-)");
      await t.settle("close:3");
      expect(t.screen, "close accepted").toBe("#1(-) #5(-)");
      await t.settle("fetch");
      expect(t.screen, "every refresh landed").toBe("#1(-) #5(-)");
    });

  // The second log already carries a guess from a third action, and that
  // guess's lane has shown. The overlay, held by assign's refresh, is seated
  // in that lane, which is judged in the same seam and holds once on the
  // overlay's stale pending. Its pass then stages the lane's next reveal. The
  // render effect read that staging as its frame's, so its run waited with
  // the frame and #3 stayed shown. A guess shows at once (F-11), beside the
  // screen's list (D-26), whatever order the overlay reads in (D-28).
  for (const read of ["serverFirst", "guessFirst", "viaMemo"] as const)
    it(`second log, ${read}: a guess into a log whose lane has shown`, async () => {
      const t = run(false, read, [1, 2, 3, 4]);
      flush();
      await tick();
      await t.settle("fetch");
      expect(t.screen).toBe("#1(-) #2(-) #3(-) #4(-)");
      t.close(4);
      await tick();
      expect(t.screen, "close #4 guessed").toBe("#1(-) #2(-) #3(-)");
      t.assign(3);
      await tick();
      expect(t.screen, "assign #3 guessed").toBe("#1(-) #2(-) #3(guest)");
      await t.settle("assign:3");
      expect(t.screen, "assign accepted, refresh in flight").toBe("#1(-) #2(-) #3(guest)");
      t.close(3);
      await tick();
      expect(t.screen, "close #3 guessed").toBe("#1(-) #2(-)");
      await t.settle("close:4");
      await t.settle("close:3");
      expect(t.screen, "both closes accepted").toBe("#1(-) #2(-)");
      while (t.asks.some(a => a.key === "fetch")) await t.settle("fetch");
      expect(t.screen, "every refresh landed").toBe("#1(-) #2(-)");
    });

  it("second log: a rejected close reverts only its own guess", async () => {
    const t = await start();
    t.assign(3);
    await tick();
    await t.settle("assign:3");
    t.close(3);
    await tick();
    expect(t.screen).toBe("#1(-)");
    await t.settle("close:3", true);
    while (t.asks.some(a => a.key === "fetch")) await t.settle("fetch");
    expect(t.screen).toBe("#1(-) #3(guest)");
  });

  // Control for the seat's other arm: the reader is held by the lane's own
  // parent (the same slot, D-33) on a new question, not a re-ask. The guess
  // still shows over that hold (F-11), beside the screen's list (D-26).
  it("same log: action 1 asks a new question after its yield; action 2's guess shows", async () => {
    const asks: { key: string; res: (v: any) => void }[] = [];
    const ask = (key: string) => new Promise<any>(res => asks.push({ key, res }));
    const settle = async (k: string, v: any) => {
      const i = asks.findIndex(a => a.key === k);
      asks.splice(i, 1)[0].res(v);
      await tick();
    };
    let screen = "";
    let assign!: (id: number, f?: string) => any;
    createRoot(() => {
      const [filter, setFilter] = createSignal("a");
      const issues = createMemo<number[]>(() => ask(`issues:${filter()}`));
      const [truth] = createSignal<number[]>(() => []);
      const [assigning, guess] = createOptimistic<number[]>(() => truth());
      const shown = createMemo(() =>
        issues()
          .map(i => `${i}${assigning().includes(i) ? "*" : ""}`)
          .join(" ")
      );
      createRenderEffect(
        () => shown(),
        v => void (screen = v)
      );
      assign = action(function* (id: number, f?: string) {
        guess(xs => [...xs, id]);
        yield ask(`assign:${id}`);
        if (f) setFilter(f);
      });
    });
    flush();
    await tick();
    await settle("issues:a", [1, 2, 3]);
    expect(screen).toBe("1 2 3");
    assign(1, "b");
    await tick();
    expect(screen).toBe("1* 2 3");
    await settle("assign:1", {});
    expect(screen).toBe("1* 2 3");
    assign(2);
    await tick();
    expect(screen).toBe("1* 2* 3");
  });
});
