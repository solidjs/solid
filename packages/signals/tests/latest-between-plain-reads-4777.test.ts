/**
 * #4777: a memo whose earlier passes never probed reads `id()`, then
 * `latest(id)` (or `isPending(id)`), then `id()` again, while an action holds
 * `id = 1`. Its first read joined the hold and was served the staging; the
 * probe made the pass a verdict reader and the second read was served the
 * screen: `before=1, latest=1, after=0`, and an async body started its
 * request with those arguments.
 *
 * The two channels of one node agree within a pass in either order (D-25,
 * A10, S-27): a plain read of a node the pass also reads ahead is the
 * screen's. The pass starts over as the verdict reader it is, so both plain
 * reads are the screen's `0`. A memo whose last answer was a flight is an
 * asker and reads the hold's staging plainly instead (S-51): not restarted.
 */
import { describe, expect, it } from "vitest";
import {
  action,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  isPending,
  latest
} from "../src/index.js";

const tick = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

describe("#4777", () => {
  for (const probe of ["latest", "isPending"] as const)
    for (const mode of ["async", "sync"] as const)
      it(`two plain reads of one signal agree around ${probe}() (${mode} body)`, async () => {
        const requests: string[] = [];
        let shown = "";
        let run!: () => any;
        let enable!: (v: boolean) => void;
        createRoot(() => {
          const [id, setId] = createSignal(0);
          const [enabled, setEnabled] = createSignal(false);
          enable = setEnabled;
          const data = createMemo(() => {
            if (!enabled()) return "Not requested";
            const before = id();
            const ahead = probe === "latest" ? latest(id) : isPending(id);
            const after = id();
            const request = `before=${before}, ${probe}=${ahead}, after=${after}`;
            requests.push(request);
            return mode === "async" ? new Promise<string>(() => {}) : request;
          });
          createRenderEffect(data, v => void (shown = v));
          run = action(function* () {
            setId(1);
            yield new Promise(() => {});
          });
        });
        flush();
        run();
        await tick();
        enable(true);
        flush();
        await tick();
        const expected = `before=0, ${probe}=${probe === "latest" ? 1 : true}, after=0`;
        expect(requests).toEqual([expected]);
        expect(shown).toBe(mode === "sync" ? expected : "Not requested");
      });
});

// The pass read a second action's held value before its probe: that join
// merged the second hold into the first. The restart gives back both, so
// each action lands on its own (D-9: nothing on screen derives from both
// once the pass is a verdict reader).
it("a restart gives back every hold the pass joined, merged ones included", async () => {
  let enable!: (v: boolean) => void, runA!: () => any, runB!: () => any;
  let endB!: () => void;
  let bShown = -1;
  const seen: string[] = [];
  createRoot(() => {
    const [a, setA] = createSignal(0);
    const [b, setB] = createSignal(0);
    const [en, setEn] = createSignal(false);
    enable = setEn;
    const m = createMemo(() => {
      if (!en()) return "off";
      const r = `a=${a()} b=${b()} la=${latest(a)} a2=${a()}`;
      seen.push(r);
      return r;
    });
    createRenderEffect(m, () => {});
    createRenderEffect(b, v => void (bShown = v));
    runA = action(function* () {
      setA(1);
      yield new Promise(() => {});
    });
    runB = action(function* () {
      setB(1);
      yield new Promise<void>(r => (endB = r));
    });
  });
  flush();
  runA();
  await tick();
  runB();
  await tick();
  enable(true);
  flush();
  await tick();
  expect(seen).toEqual(["a=0 b=0 la=1 a2=0"]);
  endB();
  await tick();
  // B landed on its own; A is still open.
  expect(bShown).toBe(1);
});
