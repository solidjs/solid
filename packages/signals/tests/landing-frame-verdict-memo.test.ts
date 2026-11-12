import { describe, expect, it } from "vitest";
import {
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  isPending,
  latest
} from "../src/index.js";

const settle = async () => {
  for (let i = 0; i < 6; i++) {
    await Promise.resolve();
    flush();
  }
};

// The landing frame of a hold shows every derivation of what landed (F-1,
// A15): a sync memo that read the screen while the hold was up (a probe
// beside a held write, D-25) re-derives, and the held runs that read it stale
// re-run on it, in the landing's frame. The inline form (`effect`) is the
// reference; the memo form showed `count` 0 beside the landed `data` for one
// frame.
describe("landing frame of a memo that probes beside a held write", () => {
  for (const probe of ["latest(count)", "isPending(data)"] as const)
    for (const form of ["memo", "effect"] as const)
      it(`${probe} (${form})`, async () => {
        const screens: string[] = [];
        let resolve!: (v: number) => void;
        const app = createRoot(dispose => {
          const [step, setStep] = createSignal(0);
          const [count, setCount] = createSignal(0);
          const data = createMemo(() => {
            const s = step();
            return s === 0 ? s : new Promise<number>(r => (resolve = r));
          });
          const body = () =>
            `${probe === "latest(count)" ? latest(count) : isPending(data) ? "p" : "-"}/${count()}`;
          const pass = createMemo(body);
          createRenderEffect(
            () => `${data()} ${form === "memo" ? pass() : body()}`,
            v => void screens.push(v)
          );
          return { dispose, setStep, setCount };
        });
        flush();
        app.setStep(1);
        app.setCount(1);
        flush();
        const before = screens.length;
        resolve(1);
        await settle();
        app.dispose();
        // Every frame after the landing shows count 1 beside data 1.
        const after = screens.slice(before).filter(s => s.startsWith("1 "));
        expect(after.length).toBeGreaterThan(0);
        expect(after[0]).toBe(probe === "latest(count)" ? "1 1/1" : "1 -/1");
      });
});
