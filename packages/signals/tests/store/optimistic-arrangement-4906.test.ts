import { expect, it } from "vitest";
import {
  action,
  createMemo,
  createOptimisticStore,
  createRenderEffect,
  createRoot,
  flush,
  latest,
  mapArray,
  refresh
} from "../../src/index.js";

// An optimistic list's arrangement (its rows in order) is one slot (D-33).
// A truth that lands beneath a guess leaves the guess on screen until its
// hold commits and is what the graph off screen derives from at once (D-34);
// a second action's guess is made on what the user sees and the two holds
// entangle. No reader, on screen or off, sees rows of two worlds mixed.
const tick = async () => {
  for (let i = 0; i < 3; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};
const show = (l: any[]) => l.map(r => r.id + (r.v ? r.v : "")).join("");

const second = {
  "push Z": [(d: any[]) => void d.push({ id: "Z", v: 0 }), "abcXZ", "bacY"],
  "remove b": [
    (d: any[]) =>
      void d.splice(
        d.findIndex(r => r.id === "b"),
        1
      ),
    "acX",
    "bacY"
  ],
  // A field guess is its row's, beside either arrangement.
  "set c.v": [(d: any[]) => void (d.find(r => r.id === "c").v = 7), "abc7X", "bac7Y"],
  reverse: [(d: any[]) => void d.reverse(), "Xcba", "bacY"]
} as const;

for (const [name, [edit, shown, ahead]] of Object.entries(second))
  it(`a second guess (${name}) over a guess a landing already corrected`, async () => {
    let server: any[] = [
      { id: "a", v: 0 },
      { id: "b", v: 0 },
      { id: "c", v: 0 }
    ];
    let list!: any[], guess!: (fn: (d: any[]) => void) => void;
    let screen = "",
      memo = "";
    createRoot(() => {
      [list, guess] = createOptimisticStore<any[]>(
        async () => {
          await Promise.resolve();
          return server.map(r => ({ ...r }));
        },
        [],
        { key: "id" }
      ) as any;
      const ids = createMemo(() => show(list) + "/" + list.length);
      const rows = mapArray(
        () => list,
        (r: any) => () => r.id + (r.v ? r.v : "")
      );
      createRenderEffect(
        () =>
          rows()
            .map(f => f())
            .join(""),
        v => void (screen = v)
      );
      createRenderEffect(ids, v => void (memo = v));
    });
    await tick();
    const frame = () => [screen, memo, latest(() => show(list))];
    let endA!: () => void, endB!: () => void;
    const A = action(function* () {
      guess(d => void d.push({ id: "X", v: 0 }));
      yield new Promise<void>(r => (endA = r));
    });
    const B = action(function* () {
      guess(edit);
      yield new Promise<void>(r => (endB = r));
    });
    const pA = A();
    await tick();
    expect(frame()).toEqual(["abcX", "abcX/4", "abcX"]);
    // Another tab reordered the rows and added one.
    server = ["b", "a", "c", "Y"].map(id => ({ id, v: 0 }));
    refresh(list as any);
    await tick();
    expect(frame()).toEqual(["abcX", "abcX/4", "bacY"]);
    const pB = B();
    await tick();
    expect(frame()).toEqual([shown, `${shown}/${shown.replace("7", "").length}`, ahead]);
    endA();
    await pA;
    await tick();
    // Entangled with B through the arrangement (or, for the field guess,
    // through the list its setter navigated): nothing commits yet.
    expect(frame()).toEqual([shown, `${shown}/${shown.replace("7", "").length}`, ahead]);
    endB();
    await pB;
    await tick();
    expect(frame()).toEqual(["bacY", "bacY/4", "bacY"]);
  });

it("a row the guess made keeps its identity and its mapping when the truth confirms its key", async () => {
  let server: any[] = [{ id: "a", title: "a" }];
  let list!: any[], guess!: (fn: (d: any[]) => void) => void;
  let mounts = 0,
    unmounts = 0,
    screen = "";
  createRoot(() => {
    [list, guess] = createOptimisticStore<any[]>(
      async () => {
        await Promise.resolve();
        return server.map(r => ({ ...r }));
      },
      [],
      { key: "id" }
    ) as any;
    const rows = mapArray(
      () => list,
      (r: any) => (mounts++, () => r.title)
    );
    createRenderEffect(
      () =>
        rows()
          .map(f => f())
          .join(","),
      v => void (screen = v)
    );
  });
  await tick();
  let end!: () => void;
  const add = action(function* () {
    guess(d => void d.push({ id: "b", title: "b (saving)" }));
    yield new Promise<void>(r => (end = r));
    refresh(list as any);
  });
  const p = add();
  await tick();
  const made = list[1];
  expect(screen).toBe("a,b (saving)");
  // Another tab's row lands first: the screen keeps the guess.
  server = [
    { id: "a", title: "a" },
    { id: "z", title: "z" }
  ];
  refresh(list as any);
  await tick();
  expect(screen).toBe("a,b (saving)");
  server = [...server, { id: "b", title: "b" }];
  end();
  await p;
  await tick();
  expect(screen).toBe("a,z,b");
  expect(list[2]).toBe(made);
  expect({ mounts, unmounts }).toEqual({ mounts: 3, unmounts: 0 });
});

it("two actions writing plain values at different indexes settle apart", async () => {
  const [list, guess] = createOptimisticStore<number[]>([0, 0, 0]);
  let seen = "";
  createRoot(() => {
    createRenderEffect(
      () => list.join(),
      v => void (seen = v)
    );
  });
  flush();
  let endA!: () => void, endB!: () => void;
  const pA = action(function* () {
    guess(d => void (d[0] = 1));
    yield new Promise<void>(r => (endA = r));
  })();
  await tick();
  const pB = action(function* () {
    guess(d => void (d[2] = 3));
    yield new Promise<void>(r => (endB = r));
  })();
  await tick();
  expect(seen).toBe("1,0,3");
  endA();
  await pA;
  await tick();
  expect(seen).toBe("0,0,3");
  endB();
  await pB;
  await tick();
  expect(seen).toBe("0,0,0");
});
