/**
 * #5253: an optimistic store whose fetch reads `filter`; an action guesses a
 * row into it and waits. Switching `filter` while the action is out is held
 * with the action (D-34, the #4337 ruling): the screen keeps `all | a,z` —
 * even after the `open` answer lands — until the action ends. The same must
 * hold once a `refresh()` of the store has landed before the action: that
 * quiet re-ask (F-9) must not make the later switch read as one.
 *
 * Controls: the fresh store, `createOptimistic`, and a bare `refresh()`
 * staying quiet (the old answer shows until the new one lands, `isPending`
 * false), with and without a guess out.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  action,
  createOptimistic,
  createOptimisticStore,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  isPending,
  refresh
} from "../src/index.js";

const tick = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

type Row = { id: string };
let cleanup: (() => void) | undefined;
afterEach(async () => {
  cleanup?.();
  cleanup = undefined;
  await tick();
});

function setup(form: "store" | "store-id" | "store-null" | "scalar") {
  const flights = new Map<string, (rows: Row[]) => void>();
  const call = (name: string) => new Promise<any>(r => flights.set(name, r));
  const answer = (name: string, rows: Row[] = []) => {
    const r = flights.get(name);
    expect(r, `flight ${name}`).toBeDefined();
    flights.delete(name);
    r!(rows);
  };
  let label = "";
  let list = "";
  let pending = false;
  const api = createRoot(dispose => {
    const [filter, setFilter] = createSignal("all");
    const fetchRows = async () => await call(filter());
    const scalar = form === "scalar";
    const [todos, setTodos] = scalar
      ? createOptimistic<Row[]>(fetchRows as any)
      : createOptimisticStore<Row[]>(
          fetchRows as any,
          [],
          form === "store" ? undefined : { key: form === "store-id" ? "id" : null }
        );
    const rows = () => (scalar ? (todos as () => Row[])() : (todos as Row[]));
    const add = action(function* () {
      (setTodos as any)((r: Row[]) => [...r, { id: "z" }]);
      yield call("add");
    });
    createRenderEffect(filter, v => {
      label = v;
    });
    createRenderEffect(
      () =>
        rows()
          .map(r => r.id)
          .join(","),
      v => {
        list = v;
      }
    );
    createRenderEffect(
      () => isPending(() => rows().length),
      v => {
        pending = v;
      }
    );
    return { dispose, setFilter, todos, add };
  });
  cleanup = () => {
    for (const r of flights.values()) r([]);
    api.dispose();
  };
  return {
    ...api,
    answer,
    has: (name: string) => flights.has(name),
    frame: () => `${label} | ${list}`,
    pending: () => pending
  };
}

async function load(t: ReturnType<typeof setup>, refreshFirst: boolean) {
  await tick();
  t.answer("all", [{ id: "a" }]);
  await tick();
  expect(t.frame()).toBe("all | a");
  if (refreshFirst) {
    const done = refresh(t.todos as any);
    flush();
    await tick();
    t.answer("all", [{ id: "a" }]);
    await done;
    await tick();
    expect(t.frame()).toBe("all | a");
  }
}

async function switchUnderGuess(t: ReturnType<typeof setup>) {
  const done = t.add();
  flush();
  await tick();
  expect(t.frame()).toBe("all | a,z");
  t.setFilter("open");
  flush();
  await tick();
  expect(t.has("open")).toBe(true);
  // Held with the action (D-34): not the new filter beside the old list.
  expect(t.frame()).toBe("all | a,z");
  // Even after the new question answers: the switch waits for the action.
  t.answer("open", [{ id: "b" }]);
  await tick();
  expect(t.frame()).toBe("all | a,z");
  t.answer("add");
  await done;
  await tick();
  expect(t.frame()).toBe("open | b");
}

describe("#5253: a switch under a store's guess is held after a landed refresh", () => {
  for (const form of ["store", "store-id", "store-null", "scalar"] as const) {
    it(`${form}: after a landed refresh`, async () => {
      const t = setup(form);
      await load(t, true);
      await switchUnderGuess(t);
    });
    it(`${form}: fresh (control)`, async () => {
      const t = setup(form);
      await load(t, false);
      await switchUnderGuess(t);
    });
  }

  it("the switch is held when the action ends before the new answer", async () => {
    const t = setup("store");
    await load(t, true);
    const done = t.add();
    flush();
    await tick();
    t.setFilter("open");
    flush();
    await tick();
    expect(t.frame()).toBe("all | a,z");
    t.answer("add");
    await done;
    await tick();
    expect(t.frame()).toBe("all | a,z");
    t.answer("open", [{ id: "b" }]);
    await tick();
    expect(t.frame()).toBe("open | b");
  });
});

describe("#5253 controls: a bare refresh() stays a quiet re-ask (F-9)", () => {
  for (const form of ["store", "store-id", "store-null"] as const) {
    it(`${form}: a second refresh keeps the old answer until the new lands`, async () => {
      const t = setup(form);
      await load(t, true);
      refresh(t.todos as any);
      flush();
      await tick();
      expect(t.has("all")).toBe(true);
      expect(t.frame()).toBe("all | a");
      expect(t.pending()).toBe(false);
      t.answer("all", [{ id: "a" }, { id: "c" }]);
      await tick();
      expect(t.frame()).toBe("all | a,c");
      expect(t.pending()).toBe(false);
    });

    it(`${form}: a refresh under the guess holds nothing new`, async () => {
      const t = setup(form);
      await load(t, true);
      const done = t.add();
      flush();
      await tick();
      refresh(t.todos as any);
      flush();
      await tick();
      expect(t.frame()).toBe("all | a,z");
      expect(t.pending()).toBe(false);
      t.answer("all", [{ id: "a" }]);
      await tick();
      expect(t.frame()).toBe("all | a,z");
      t.answer("add");
      await done;
      await tick();
      expect(t.frame()).toBe("all | a");
    });
  }
});
