/**
 * #4666: #4629's shape with the second guess in a different `createOptimistic`.
 * Action 1 (assign) is accepted and its `refresh(server)` is in flight when
 * action 2 (close) guesses into its own log. The close guess shows at once
 * beside the screen's rows (D-26), as it does when written into the same log.
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

type Read = "listFirst" | "logFirst" | "viaMemo";

function run(read: Read) {
  const asks: { key: string; res: (v: any) => void; rej: (e: any) => void }[] = [];
  const ask = (key: string) => new Promise<any>((res, rej) => asks.push({ key, res, rej }));
  const settle = async (key: string, v: any = {}, fail = false) => {
    const i = asks.findIndex(a => a.key === key);
    const a = asks.splice(i, 1)[0];
    fail ? a.rej(v) : a.res(v);
    await tick();
  };
  const serverRows: Row[] = [{ id: 1 }, { id: 3 }];
  const frames: string[] = [];
  let assign!: (id: number) => any;
  let close!: (id: number) => any;
  createRoot(() => {
    const server = createMemo(() => ask("fetch").then(() => serverRows.map(r => ({ ...r }))));
    const [assignTruth] = createSignal(() => [] as number[]);
    const [assigning, guessAssign] = createOptimistic(() => assignTruth());
    const [closeTruth] = createSignal(() => [] as number[]);
    const [closing, guessClose] = createOptimistic(() => closeTruth());
    const closedSet = createMemo(() => new Set(closing()));
    const isClosed = (id: number) =>
      read === "viaMemo" ? closedSet().has(id) : closing().includes(id);
    const shown = createMemo(() => {
      if (read === "logFirst") closing();
      return server()
        .filter(r => !isClosed(r.id))
        .map(r => `#${r.id}(${assigning().includes(r.id) ? "guest" : (r.who ?? "-")})`)
        .join(" ");
    });
    createRenderEffect(
      () => shown(),
      v => {
        frames.push(v);
      }
    );
    assign = action(function* (id: number) {
      guessAssign(xs => [...xs, id]);
      yield ask(`assign:${id}`);
      serverRows.find(r => r.id === id)!.who = "guest";
      serverRows.push({ id: 5 });
      refresh(server);
    });
    close = action(function* (id: number) {
      guessClose(xs => [...xs, id]);
      try {
        yield ask(`close:${id}`);
      } catch {
        return;
      }
      serverRows.splice(
        serverRows.findIndex(r => r.id === id),
        1
      );
      refresh(server);
    });
  });
  const last = () => frames[frames.length - 1];
  return { settle, last, assign: (id: number) => assign(id), close: (id: number) => close(id) };
}

async function toCloseGuess(read: Read) {
  const t = run(read);
  await tick();
  await t.settle("fetch");
  expect(t.last()).toBe("#1(-) #3(-)");
  t.assign(3);
  await tick();
  expect(t.last()).toBe("#1(-) #3(guest)");
  await t.settle("assign:3");
  // assign's refresh(server) is in flight
  expect(t.last()).toBe("#1(-) #3(guest)");
  t.close(3);
  await tick();
  return t;
}

describe("#4666: a guess in a second log beside another action's re-ask", () => {
  for (const read of ["listFirst", "logFirst", "viaMemo"] as const)
    it(`the guess shows at once and stays (${read})`, async () => {
      const t = await toCloseGuess(read);
      expect(t.last()).toBe("#1(-)");
      // assign's re-ask lands beneath the close guess
      await t.settle("fetch");
      expect(t.last()).toBe("#1(-) #5(-)");
      await t.settle("close:3");
      expect(t.last()).toBe("#1(-) #5(-)");
      await t.settle("fetch");
      expect(t.last()).toBe("#1(-) #5(-)");
    });

  // D-28: the frames of a rejected close do not depend on the read order.
  it("a rejected close: the same frames in either read order, the row back at the end", async () => {
    const seen: string[][] = [];
    for (const read of ["listFirst", "logFirst", "viaMemo"] as const) {
      const t = await toCloseGuess(read);
      const f = [t.last()];
      await t.settle("close:3", new Error("no"), true);
      f.push(t.last());
      await t.settle("fetch");
      f.push(t.last());
      seen.push(f);
    }
    expect(seen[0][0]).toBe("#1(-)");
    expect(seen[1]).toEqual(seen[0]);
    expect(seen[2]).toEqual(seen[0]);
    expect(seen[0][2]).toBe("#1(-) #3(guest) #5(-)");
  });
});
