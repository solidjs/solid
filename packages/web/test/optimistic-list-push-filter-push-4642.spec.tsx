/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
import { render } from "@solidjs/web";
import { action, createOptimisticStore, flush, For, Loading, refresh } from "solid-js";
import { describe, expect, it } from "vitest";

const tick = async () => {
  for (let i = 0; i < 2; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};
type Todo = { id: number; title: string };

// The cheatsheet's todo list (#4642): an optimistic store over `list`, with
// actions that write a guess, yield the save, then refresh the list.
function todoList() {
  let server: Todo[] = [
    { id: 1, title: "milk" },
    { id: 2, title: "eggs" }
  ];
  const out: { key: string; go: (ok: boolean) => void }[] = [];
  const call = (key: string, apply?: () => void) =>
    new Promise<any>((resolve, reject) =>
      out.push({
        key,
        go: (ok: boolean) => {
          if (!ok) return reject(new Error(key));
          apply?.();
          resolve(key === "list" ? server.map(t => ({ ...t })) : true);
        }
      })
    );
  const land = (key: string, ok = true) =>
    out
      .splice(
        out.findIndex(f => f.key === key),
        1
      )[0]
      .go(ok);
  const el = document.createElement("div");
  let add!: (t: Todo) => Promise<unknown>;
  let remove!: (id: number) => Promise<unknown>;
  let rename!: (id: number, title: string) => Promise<unknown>;
  const dispose = render(() => {
    const [todos, setTodos] = createOptimisticStore<Todo[]>(() => call("list"), []);
    add = action(function* (todo: Todo) {
      setTodos((s: Todo[]) => {
        s.push(todo);
      });
      try {
        yield call("add:" + todo.id, () => {
          server = [...server, todo];
        });
      } catch {}
      refresh(todos);
    });
    remove = action(function* (id: number) {
      setTodos((s: Todo[]) => s.filter((x: Todo) => x.id !== id));
      try {
        yield call("remove:" + id, () => {
          server = server.filter(t => t.id !== id);
        });
      } catch {}
      refresh(todos);
    });
    rename = action(function* (id: number, title: string) {
      setTodos((s: Todo[]) => {
        const row = s.find((x: Todo) => x.id === id);
        if (row) row.title = title;
      });
      try {
        yield call("rename:" + id, () => {
          server = server.map(t => (t.id === id ? { ...t, title } : t));
        });
      } catch {}
      refresh(todos);
    });
    return (
      <Loading fallback={<p>loading</p>}>
        <For each={todos}>{(t: Todo) => <li>[{t.title}]</li>}</For>
      </Loading>
    );
  }, el);
  const step = async (fn: () => void) => {
    fn();
    flush();
    await tick();
  };
  const drain = async () => {
    while (out.length) await step(() => land(out[0].key));
  };
  return {
    out,
    land,
    step,
    drain,
    dispose,
    add,
    remove,
    rename,
    get shown() {
      return el.textContent!;
    },
    get server() {
      return server.map(t => "[" + t.title + "]").join("");
    }
  };
}

describe("#4642: an optimistic list's guesses compose on the list as it stands", () => {
  // F-11: the guess is the value of its slot for the screen; the second push
  // composes on the filtered list.
  for (const removeWhich of ["other", "just-added"] as const)
    it(`add, delete (${removeWhich}), add: the second add's guess renders`, async () => {
      const s = todoList();
      await tick();
      await s.step(() => s.land("list"));
      await s.step(() => s.add({ id: 3, title: "jam" }));
      await s.step(() => s.remove(removeWhich === "other" ? 2 : 3));
      await s.step(() => s.add({ id: 4, title: "tea" }));
      const expected = removeWhich === "other" ? "[milk][jam][tea]" : "[milk][eggs][tea]";
      expect(s.shown).toBe(expected);
      await s.drain();
      expect(s.shown).toBe(expected);
      expect(s.shown).toBe(s.server);
      s.dispose();
    });

  // Ruled 2026-11-03 (#4656): before its first answer the list is loading,
  // not a value to be optimistic over — in DEV the add throws
  // OPTIMISTIC_WRITE_BEFORE_LOAD, nothing is guessed, and the first load
  // shows as it lands.
  it("an add before the first load lands: OPTIMISTIC_WRITE_BEFORE_LOAD", async () => {
    const s = todoList();
    await tick();
    let error: unknown;
    await s.step(() => {
      s.add({ id: 3, title: "jam" }).catch(e => (error = e));
    });
    expect(String(error)).toMatch(/OPTIMISTIC_WRITE_BEFORE_LOAD/);
    expect(s.shown).toBe("loading");
    await s.step(() => s.land("list"));
    expect(s.shown).toBe("[milk][eggs]");
    await s.step(() => s.add({ id: 3, title: "jam" }));
    expect(s.shown).toBe("[milk][eggs][jam]");
    await s.drain();
    expect(s.shown).toBe("[milk][eggs][jam]");
    s.dispose();
  });

  // F-11: a guess shows from the flush that carries it, also while an
  // earlier action's refresh is out — that refresh re-asks the earlier
  // guess's own question (D-34 ¶3) and holds that action, not the new
  // guesses. Its answer, older than them, re-bases them by row key (D-35):
  // the row the delete removed stays removed beside it (#4656).
  it("add, its save lands, delete, add: each guess shows at once", async () => {
    const s = todoList();
    await tick();
    await s.step(() => s.land("list"));
    await s.step(() => s.add({ id: 3, title: "jam" }));
    await s.step(() => s.land("add:3"));
    await s.step(() => s.remove(1));
    expect(s.shown).toBe("[eggs][jam]");
    await s.step(() => s.add({ id: 4, title: "tea" }));
    expect(s.shown).toBe("[eggs][jam][tea]");
    await s.step(() => s.land("list"));
    expect(s.shown).toBe("[eggs][jam][tea]");
    await s.step(() => s.add({ id: 5, title: "oats" }));
    expect(s.shown).toBe("[eggs][jam][tea][oats]");
    await s.drain();
    expect(s.shown).toBe("[eggs][jam][tea][oats]");
    expect(s.shown).toBe(s.server);
    s.dispose();
  });

  // D-33/D-35: the declined delete reverts its own write; the add settles
  // under the truth, rows matched by key (D-34).
  for (const renameFirst of [false, true])
    it(`a declined delete, then an add, settles to the server (rename first=${renameFirst})`, async () => {
      const s = todoList();
      await tick();
      await s.step(() => s.land("list"));
      if (renameFirst) await s.step(() => s.rename(1, "oat milk"));
      await s.step(() => s.remove(1));
      await s.step(() => s.land("remove:1", false));
      await s.step(() => s.add({ id: 3, title: "jam" }));
      await s.drain();
      expect(s.shown).toBe(s.server);
      expect(s.shown).toBe(`[${renameFirst ? "oat milk" : "milk"}][eggs][jam]`);
      s.dispose();
    });
});
