import {
  createEffect,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  getOwner,
  onCleanup
} from "../src/index.js";

afterEach(() => flush());

// Same walk as DEV.getChildren, inline so it also runs under SIGNALS_TIER=observe.
function chain(owner: any): string[] {
  const out: string[] = [];
  for (let c = owner._firstChild; c; c = c._nextSibling) out.push(c._name);
  return out;
}

function setup() {
  const runs = { X: 0, Y: 0, m1: 0 };
  let owner!: any;
  let m1!: () => number;
  let setRead!: (v: boolean) => void;
  let setTick!: (v: number) => void;

  const dispose = createRoot(d => {
    owner = getOwner()!;
    const [read, _setRead] = createSignal(true);
    const [tick, _setTick] = createSignal(0);
    setRead = _setRead;
    setTick = _setTick;
    createEffect(tick, () => void runs.X++, { name: "X" });
    m1 = createMemo(() => (runs.m1++, tick() * 2), { lazy: true, name: "m1" });
    createRenderEffect(
      () => (read() ? m1() : -1),
      () => {},
      { name: "reader" }
    );
    createEffect(tick, () => void runs.Y++, { name: "Y" });
    return d;
  });
  flush();
  return { runs, owner, m1, setRead, setTick, dispose };
}

it("a lazy memo's second dormancy leaves its live siblings owned by the root", () => {
  const { runs, owner, setRead, setTick, dispose } = setup();
  expect(chain(owner)).toEqual(["Y", "reader", "m1", "X"]);

  setRead(false);
  flush();
  expect(chain(owner)).toEqual(["Y", "reader", "X"]);

  setRead(true);
  flush();
  setRead(false);
  flush();
  expect(chain(owner)).toEqual(["Y", "reader", "X"]);

  const x = runs.X;
  const y = runs.Y;
  dispose();
  setTick(1);
  flush();
  setTick(2);
  flush();
  expect(runs.X).toBe(x);
  expect(runs.Y).toBe(y);
});

it("a reawakened lazy memo dies with its owner", () => {
  const { runs, m1, setRead, setTick, dispose } = setup();

  setRead(false);
  flush();
  setRead(true);
  flush();
  expect(m1()).toBe(0);

  dispose();
  setTick(1);
  flush();
  const evals = runs.m1;
  expect(m1()).toBe(0);
  expect(runs.m1).toBe(evals);
});

it("a dormant lazy memo read after its owner's dispose stays off the dead chain", () => {
  const { owner, m1, setRead, dispose } = setup();

  setRead(false);
  flush();
  expect(chain(owner)).toEqual(["Y", "reader", "X"]);

  dispose();
  expect(chain(owner)).toEqual([]);

  expect(m1()).toBe(0);
  expect(chain(owner)).toEqual([]);
  flush();
  expect(m1()).toBe(0);
  expect(chain(owner)).toEqual([]);
});

it("a dormant lazy memo read after its owner's dispose freezes instead of reawakening", () => {
  const { runs, m1, setRead, setTick, dispose } = setup();

  setRead(false);
  flush();
  dispose();

  const evals = runs.m1;
  let seen = -1;
  const disposeReader = createRoot(d => {
    createEffect(m1, v => void (seen = v), { name: "outside" });
    return d;
  });
  flush();
  expect(seen).toBe(0);
  expect(runs.m1).toBe(evals);

  setTick(1);
  flush();
  setTick(2);
  flush();
  expect(m1()).toBe(0);
  expect(seen).toBe(0);
  expect(runs.m1).toBe(evals);
  disposeReader();
});

it("a lazy memo a cleanup reawakens while its owner's held children are torn down stays on the chain", () => {
  let owner!: any;
  let m1!: () => number;
  let setTick!: (v: number) => void;
  let gen = 0;
  const dispose = createRoot(d => {
    const [tick, _setTick] = createSignal(0);
    setTick = _setTick;
    const held = createMemo(
      () => {
        tick();
        owner = getOwner()!;
        const g = ++gen;
        const m = createMemo(() => g, { lazy: true, name: "m" + g });
        if (g === 1) m1 = m;
        createRenderEffect(
          () => {
            onCleanup(() => m1());
          },
          () => {},
          { name: "cleanup" + g }
        );
        return new Promise<number>(() => {});
      },
      { name: "held" }
    );
    createRenderEffect(held, () => {});
    return d;
  });
  flush();
  expect(chain(owner)).toEqual(["cleanup1", "m1"]);

  m1();
  flush();
  expect(chain(owner)).toEqual(["cleanup1"]);

  setTick(1);
  flush();
  expect(chain(owner)).toEqual(["cleanup2", "m2", "m1"]);

  m1();
  flush();
  expect(chain(owner)).toEqual(["cleanup2", "m2"]);
  dispose();
});
