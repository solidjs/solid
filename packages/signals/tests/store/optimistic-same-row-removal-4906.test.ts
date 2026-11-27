import {
  action,
  createOptimisticStore,
  createRenderEffect,
  createRoot,
  flush,
  mapArray
} from "../../src/index.js";

// D-33 (ruled 2026-11-18): a setter that reads another action's live guess
// and writes nothing because of it depends on that guess landing: the two
// actions entangle, and the first guess stays while the second runs.
const settle = async () => {
  for (let i = 0; i < 3; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

for (const form of ["seeded list", "derived list", "record", "leaf"] as const)
  it(`two actions making the same guess entangle (${form})`, async () => {
    let store!: any, guess!: (fn: (d: any) => void) => void;
    let screen = "";
    createRoot(() => {
      if (form === "record" || form === "leaf")
        [store, guess] = createOptimisticStore<any>({ a: 1, b: 2 }) as any;
      else if (form === "seeded list")
        [store, guess] = createOptimisticStore<any>([{ id: 1 }, { id: 2 }]) as any;
      else [store, guess] = createOptimisticStore<any>(() => [{ id: 1 }, { id: 2 }], []) as any;
      if (form === "record")
        createRenderEffect(
          () => Object.keys(store).join(),
          v => void (screen = v)
        );
      else if (form === "leaf")
        createRenderEffect(
          () => String(store.a),
          v => void (screen = v)
        );
      else {
        const rows = mapArray(
          () => store,
          (row: any) => row.id
        );
        createRenderEffect(
          () => rows().join(),
          v => void (screen = v)
        );
      }
    });
    flush();
    const start = screen;
    const edit = (d: any) => {
      if (form === "record") delete d.a;
      else if (form === "leaf") d.a = 9;
      else {
        const at = d.findIndex((r: any) => r.id === 1);
        if (at >= 0) d.splice(at, 1);
      }
    };
    let endA!: () => void, endB!: () => void;
    const A = action(function* () {
      guess(edit);
      yield new Promise<void>(r => (endA = r));
    });
    const B = action(function* () {
      guess(edit);
      yield new Promise<void>(r => (endB = r));
    });
    const pA = A();
    await settle();
    const guessed = screen;
    expect(guessed).not.toBe(start);
    const pB = B();
    await settle();
    expect(screen).toBe(guessed);
    endA();
    await pA;
    await settle();
    // B still runs: the guess it found in place stays.
    expect(screen).toBe(guessed);
    endB();
    await pB;
    await settle();
    expect(screen).toBe(start);
  });
