(globalThis as any).THIN_STORE = true;
import {
  action,
  createOptimisticStore,
  createRenderEffect,
  createRoot,
  createSignal,
  flush
} from "../../src/index.js";
import { expect, it } from "vitest";
it("swap under action, derived truth", async () => {
  const init = () => ["a", "b", "c"].map(id => ({ id, text: id.toUpperCase() }));
  const [truth, setTruth] = createSignal(init());
  const [view, setView] = createOptimisticStore<any[]>(() => {
    (globalThis as any).__runs = ((globalThis as any).__runs || 0) + 1;
    return truth();
  }, []);
  const frames: string[] = [];
  createRoot(() =>
    createRenderEffect(
      () => view.map((r: any) => r.id + ":" + r.text).join(","),
      v => {
        frames.push(v);
      }
    )
  );
  flush();
  let release!: () => void;
  const gate = new Promise<void>(r => (release = r));
  const act = action(function* () {
    setView((d: any[]) => {
      const t = d[0];
      d[0] = d[1];
      d[1] = t;
    });
    yield gate;
    setTruth(prev => {
      const n = prev.map(r => ({ ...r }));
      const t = n[0];
      n[0] = n[1];
      n[1] = t;
      return n;
    });
  });
  act();
  flush();
  frames.push("--applied");
  release();
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
    flush();
  }
  await new Promise(r => setTimeout(r, 0));
  flush();
  frames.push("view=" + view.map((r: any) => r.id).join(""));
  let runs = 0;
  expect(frames).toEqual(["a:A,b:B,c:C", "b:B,a:A,c:C", "--applied", "view=bac"]);
});
