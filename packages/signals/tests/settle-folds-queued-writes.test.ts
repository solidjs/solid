// When an async node lands, core re-enters the transition waiting on it.
// Writes still queued at that point — made earlier in the same synchronous
// run, before the next flush — join that transition and commit with it.
//
// Consumers rely on this: `dynamic()` delivers a server component's new
// address to its mounted instance from the resolution callback, just before
// the landing, so the instance's rebind (and the morph it drives) waits for
// the transition's commit like everything else the transition holds.
//
// A write with nothing landing behind it is a plain write and applies now.
import {
  action,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush
} from "../src/index.js";

afterEach(() => flush());

const tick = () => new Promise(r => setTimeout(r));

/** A transition held by two async reads, `a` and `b`; `s` is unrelated. */
function setup(beforeLanding?: () => void) {
  let releaseA!: () => void;
  let releaseB!: () => void;
  const log: string[] = [];
  const [x, setX] = createSignal(0);
  const [s, setS] = createSignal("s0");
  createRoot(() => {
    const a = createMemo(() => {
      if (x() === 0) return "a0";
      const p = new Promise<string>(r => (releaseA = () => r("a1")));
      // Registered before the memo's own handler, so it runs first.
      if (beforeLanding) p.then(beforeLanding);
      return p;
    });
    const b = createMemo(() =>
      x() === 0 ? "b0" : new Promise<string>(r => (releaseB = () => r("b1")))
    );
    createRenderEffect(a, v => void log.push(`a=${v}`));
    createRenderEffect(b, v => void log.push(`b=${v}`));
    createRenderEffect(s, v => void log.push(`s=${v}`));
  });
  flush();
  log.length = 0;
  action(function* () {
    setX(1);
  })();
  return { log, setS, releaseA: () => releaseA(), releaseB: () => releaseB() };
}

describe("a landing folds the writes queued ahead of it into its transition", () => {
  it("a write queued just before a landing commits with the transition", async () => {
    let setS!: (v: string) => void;
    const t = setup(() => setS("s1"));
    setS = t.setS;
    await tick();

    t.releaseA();
    await tick();
    // `a` landed and its transition still waits on `b`: so does the write.
    expect(t.log).toEqual([]);

    t.releaseB();
    await tick();
    expect(t.log).toContain("s=s1");
    expect(t.log).toContain("a=a1");
    expect(t.log).toContain("b=b1");
  });

  it("a write with no landing behind it applies at once", async () => {
    const t = setup();
    await tick();

    t.setS("s1");
    await tick();
    expect(t.log).toEqual(["s=s1"]);

    t.releaseA();
    t.releaseB();
    await tick();
    expect(t.log).toEqual(["s=s1", "b=b1", "a=a1"]);
  });
});
