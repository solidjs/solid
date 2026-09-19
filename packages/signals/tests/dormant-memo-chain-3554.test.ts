import {
  createEffect,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  getOwner
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
