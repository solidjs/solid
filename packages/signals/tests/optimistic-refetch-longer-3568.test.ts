/**
 * #3568 — after one optimistic push or splice on a createOptimisticStore, a
 * refetch that returns MORE rows than the optimistic view showed hands
 * index readers a torn frame at settle: `length` already carries its new
 * value while the new index reads `undefined`, and the reader is never run
 * again when the row arrives. The hole is always at an index no reader had
 * read before the action, and only a structural edit (one that overrides
 * `length`) tears — record key-set edits reveal coherently.
 */
import {
  action,
  createOptimisticStore,
  createRenderEffect,
  createRoot,
  flush,
  mapArray,
  refresh
} from "../src/index.js";

afterEach(() => flush());

const tick = () => new Promise(r => setTimeout(r, 0));
const settle = async (n = 3) => {
  for (let i = 0; i < n; i++) {
    await tick();
    flush();
  }
};

type Row = { id: number };
const render = (rows: Row[]) =>
  Array.from(rows, r => (r ? String(r.id) : "HOLE")).join(",") + " len=" + rows.length;

function setup(initial: Row[], preRead = -1) {
  let db = initial;
  const fetches: Array<() => void> = [];
  const frames: string[] = [];
  const mapped: string[] = [];
  const rowCalls: string[] = [];
  let todos!: Row[];
  let setTodos!: (fn: (d: Row[]) => void) => void;
  let dispose!: () => void;
  createRoot(d => {
    dispose = d;
    [todos, setTodos] = createOptimisticStore<Row[]>(
      () => new Promise<Row[]>(res => fetches.push(() => res(db.map(t => ({ ...t }))))),
      []
    );
    createRenderEffect(
      () => {
        if (preRead >= 0) todos[preRead];
        return render(todos);
      },
      frame => {
        frames.push(frame);
      }
    );
    const rows = mapArray(
      () => todos,
      r => {
        rowCalls.push(r ? String(r.id) : "HOLE");
        return r ? String(r.id) : "HOLE";
      }
    );
    createRenderEffect(
      () => rows().join(","),
      frame => {
        mapped.push(frame);
      }
    );
  });
  const run = (edit: (d: Row[]) => void, next: Row[]) => {
    let confirm!: () => void;
    const confirmed = new Promise<void>(res => (confirm = res));
    const act = action(function* () {
      setTodos(edit);
      yield confirmed;
      db = next;
      refresh(todos as any);
    });
    return { act, confirm };
  };
  return {
    get todos() {
      return todos;
    },
    fetches,
    frames,
    mapped,
    rowCalls,
    run,
    dispose
  };
}

describe("#3568 refetch longer than the optimistic view", () => {
  it("push: the index past the optimistic length reveals with the row, not undefined", async () => {
    const h = setup([{ id: 1 }, { id: 2 }]);
    flush();
    h.fetches.shift()!();
    await settle();
    expect(h.frames.at(-1)).toBe("1,2 len=2");

    const { act, confirm } = h.run(
      d => {
        d.push({ id: 3 });
      },
      [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }]
    );
    const done = act();
    await settle();
    expect(h.frames.at(-1)).toBe("1,2,3 len=3");

    confirm();
    await done;
    await settle();
    h.fetches.shift()!();
    await settle();

    expect(render(h.todos)).toBe("1,2,3,4 len=4");
    expect(h.frames.at(-1)).toBe("1,2,3,4 len=4");
    expect(h.frames).not.toContain("1,2,3,HOLE len=4");
    expect(h.mapped.at(-1)).toBe("1,2,3,4");
    expect(h.mapped).not.toContain("1,2,3,HOLE");
    expect(h.rowCalls).not.toContain("HOLE");
    h.dispose();
  });

  it("push: an index read before the action still reveals with its row", async () => {
    const h = setup([{ id: 1 }, { id: 2 }], 3);
    flush();
    h.fetches.shift()!();
    await settle();

    const { act, confirm } = h.run(
      d => {
        d.push({ id: 3 });
      },
      [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }]
    );
    const done = act();
    await settle();
    confirm();
    await done;
    await settle();
    h.fetches.shift()!();
    await settle();

    expect(h.frames.at(-1)).toBe("1,2,3,4 len=4");
    expect(h.mapped.at(-1)).toBe("1,2,3,4");
    expect(h.rowCalls).not.toContain("HOLE");
    h.dispose();
  });

  it("splice: a refetch longer than the spliced view reveals every row", async () => {
    const h = setup([{ id: 1 }, { id: 2 }]);
    flush();
    h.fetches.shift()!();
    await settle();
    expect(h.frames.at(-1)).toBe("1,2 len=2");

    const { act, confirm } = h.run(
      d => {
        d.splice(0, 1);
      },
      [{ id: 2 }, { id: 3 }, { id: 4 }]
    );
    const done = act();
    await settle();
    expect(h.frames.at(-1)).toBe("2 len=1");

    confirm();
    await done;
    await settle();
    h.fetches.shift()!();
    await settle();

    expect(render(h.todos)).toBe("2,3,4 len=3");
    expect(h.frames.at(-1)).toBe("2,3,4 len=3");
    expect(h.frames).not.toContain("2,3,HOLE len=3");
    expect(h.mapped.at(-1)).toBe("2,3,4");
    expect(h.rowCalls).not.toContain("HOLE");
    h.dispose();
  });

  it("nested array: a longer refetch under an object root reveals every row", async () => {
    type Board = { todo: Row[] };
    let db: Board = { todo: [{ id: 1 }, { id: 2 }] };
    const fetches: Array<() => void> = [];
    const frames: string[] = [];
    let board!: Board;
    let setBoard!: (fn: (d: Board) => void) => void;
    let dispose!: () => void;
    createRoot(d => {
      dispose = d;
      [board, setBoard] = createOptimisticStore<Board>(
        () =>
          new Promise<Board>(res =>
            fetches.push(() => res({ todo: db.todo.map(t => ({ ...t })) }))
          ),
        { todo: [] }
      );
      createRenderEffect(
        () => render(board.todo),
        frame => {
          frames.push(frame);
        }
      );
    });
    flush();
    fetches.shift()!();
    await settle();
    expect(frames.at(-1)).toBe("1,2 len=2");

    let confirm!: () => void;
    const confirmed = new Promise<void>(res => (confirm = res));
    const add = action(function* () {
      setBoard(d => {
        d.todo.push({ id: 3 });
      });
      yield confirmed;
      db = { todo: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }] };
      refresh(board as any);
    });
    const done = add();
    await settle();
    expect(frames.at(-1)).toBe("1,2,3 len=3");

    confirm();
    await done;
    await settle();
    fetches.shift()!();
    await settle();

    expect(render(board.todo)).toBe("1,2,3,4 len=4");
    expect(frames.at(-1)).toBe("1,2,3,4 len=4");
    expect(frames).not.toContain("1,2,3,HOLE len=4");
    dispose();
  });
});
