// A write made from a computation's compute half while it runs under a held
// transition joins that transition: it is held with everything else the
// transition holds, and computations under the transition read it ahead of
// the settle that ends the action's optimistic overrides.
//
// Consumers rely on this: a server-component mount commits a refetched
// region in two phases. When its address accessor delivers the new content
// token, the mount's compute half pushes the region's slot args into the
// live fills — under the transition, so a fill deriving `intent ?? arg`
// reads the new arg while the intent is still live — and its effect half
// morphs the markup at the commit.
import {
  action,
  createMemo,
  createOptimistic,
  createRenderEffect,
  createRoot,
  createSignal,
  flush
} from "../src/index.js";

afterEach(() => flush());

const tick = () => new Promise(r => setTimeout(r));

function setup() {
  let release!: () => void;
  let releaseOther!: () => void;
  const trace: string[] = [];
  const shown: string[] = [];
  const [x, setX] = createSignal(0);
  const [token, setToken] = createSignal("t0", { ownedWrite: true });
  const [arg, setArg] = createSignal(false, { ownedWrite: true });
  const [intent, setIntent] = createOptimistic<boolean | undefined>(undefined);
  createRoot(() => {
    const source = createMemo(() => {
      if (x() === 0) return "t0";
      const p = new Promise<string>(r => (release = () => r("t1")));
      // The delivery: registered before the memo's own handler, so it runs
      // just ahead of the landing (as `dynamic` delivers an address).
      p.then(v => setToken(v));
      return p;
    });
    // The mount: its compute half pushes the args a new token carries.
    createRenderEffect(
      () => {
        const t = token();
        if (t === "t1") setArg(true);
        return t;
      },
      t => void shown.push(`token=${t}`)
    );
    // The fill: derives the intent over the server's arg.
    createMemo(() => trace.push(`${arg()}/${intent() ?? arg()}`));
    createRenderEffect(arg, v => void shown.push(`arg=${v}`));
    createRenderEffect(source, () => {});
    // A second read the same transition waits on (the `other` flag only).
    const other = createMemo(() =>
      x() === 2 ? new Promise<string>(r => (releaseOther = () => r("o1"))) : "o0"
    );
    createRenderEffect(other, () => {});
  });
  flush();
  shown.length = 0;
  const write = action(function* (n: number) {
    setIntent(true);
    setX(n);
  });
  return {
    trace,
    shown,
    write: (n = 1) => write(n),
    release: () => release(),
    releaseOther: () => releaseOther()
  };
}

describe("a compute-half write under a held transition joins it", () => {
  it("is held while the transition still waits, and commits with it", async () => {
    const t = setup();
    t.write(2);
    await tick();

    t.release();
    await tick();
    // The token landed and the compute half wrote the arg; the transition
    // still waits on `other`, so neither the token nor the arg is shown.
    expect(t.shown).toEqual([]);

    t.releaseOther();
    await tick();
    expect(t.shown).toEqual(["token=t1", "arg=true"]);
  });

  it("the fill never reads the server's old arg once the intent was written", async () => {
    const t = setup();
    expect(t.trace).toEqual(["false/false"]);

    t.write();
    await tick();
    expect(t.trace).toEqual(["false/false", "false/true"]);

    t.release();
    await tick();
    expect(t.shown).toEqual(["token=t1", "arg=true"]);
    expect(t.trace.slice(2).filter(entry => entry.endsWith("/false"))).toEqual([]);
    expect(t.trace.at(-1)).toBe("true/true");
  });
});
