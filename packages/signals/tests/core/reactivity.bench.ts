import { afterAll, bench } from "vitest";
import { createMemo, createRoot, createSignal, flush } from "../../src/index.js";

const COUNT = 10_000;
const UPDATE_COUNT = 2_000;
const FANOUT = 250;
const filter = new RegExp(process.env.FILTER || ".+");
const cleanups: (() => void)[] = [];

afterAll(() => {
  for (let i = 0; i < cleanups.length; i++) cleanups[i]();
});

function runBench(name: string, fn: () => void) {
  if (filter.test(name)) bench(name, fn);
}

runBench("createSignals", () => {
  const sources = new Array<() => number>(COUNT);
  for (let i = 0; i < COUNT; i++) {
    const [source] = createSignal(i);
    sources[i] = source;
  }
});

runBench("createComputations:create0to1", () => {
  createRoot(dispose => {
    for (let i = 0; i < COUNT; i++) {
      createMemo(() => i);
    }
    dispose();
  });
});

runBench("createComputations:create1to1", () => {
  const sources = new Array<() => number>(COUNT);
  for (let i = 0; i < COUNT; i++) {
    const [source] = createSignal(i);
    sources[i] = source;
  }

  createRoot(dispose => {
    for (let i = 0; i < COUNT; i++) {
      const source = sources[i];
      createMemo(() => source());
    }
    dispose();
  });
});

if (filter.test("updateSignals:update1to1")) {
  const setters = new Array<(value: number) => number>(COUNT);
  let value = 0;
  createRoot(dispose => {
    cleanups.push(dispose);
    for (let i = 0; i < COUNT; i++) {
      const [source, setSource] = createSignal(i);
      createMemo(() => source());
      setters[i] = setSource;
    }
  });

  bench("updateSignals:update1to1", () => {
    value++;
    flush(() => {
      for (let i = 0; i < COUNT; i++) setters[i](value + i);
    });
  });
}

if (filter.test("updateSignals:update1to1000")) {
  let value = 0;
  let setSource!: (value: number) => number;
  createRoot(dispose => {
    cleanups.push(dispose);
    const [source, set] = createSignal(0);
    setSource = set;
    for (let i = 0; i < FANOUT; i++) createMemo(() => source());
  });

  bench("updateSignals:update1to1000", () => {
    flush(() => {
      for (let i = 0; i < UPDATE_COUNT; i++) setSource(++value);
    });
  });
}

if (filter.test("propagation:diamond")) {
  let value = 0;
  let setSource!: (value: number) => number;
  createRoot(dispose => {
    cleanups.push(dispose);
    const [source, set] = createSignal(0);
    setSource = set;
    const left = createMemo(() => source() + 1);
    const right = createMemo(() => source() + 2);
    createMemo(() => left() + right());
  });

  bench("propagation:diamond", () => {
    flush(() => {
      for (let i = 0; i < UPDATE_COUNT; i++) setSource(++value);
    });
  });
}

if (filter.test("propagation:avoidable")) {
  let value = 0;
  let setSource!: (value: number) => number;
  createRoot(dispose => {
    cleanups.push(dispose);
    const [source, set] = createSignal(0);
    setSource = set;
    const parity = createMemo(() => source() & 1);
    for (let i = 0; i < FANOUT; i++) createMemo(() => parity());
  });

  bench("propagation:avoidable", () => {
    flush(() => {
      for (let i = 0; i < UPDATE_COUNT; i++) setSource(++value * 2);
    });
  });
}
