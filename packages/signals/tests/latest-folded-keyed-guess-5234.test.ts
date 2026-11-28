/**
 * D-22, D-34: `latest` of a shown keyed-list guess answers the guess until its
 * hold commits, also when an outside `refresh()` landed the truth beneath it
 * (the folded arrangement, #5234).
 */
import {
  action,
  createEffect,
  createMemo,
  createOptimistic,
  createOptimisticStore,
  createProjection,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  isPending,
  latest,
  refresh,
  type Refreshable
} from "../src/index.js";

/** Called after each flush: the frame the screen shows between flushes. */
let snap: (() => void) | null = null;
const step = () => (flush(), snap?.());
afterEach(() => ((snap = null), flush()));

const tick = () => new Promise(r => setTimeout(r, 0));
const settle = async (n = 4) => {
  for (let i = 0; i < n; i++) {
    await tick();
    step();
  }
};

type Row = { id: number };

function build(key: "id" | null) {
  let rows: Row[] = [{ id: 1 }, { id: 2 }, { id: 3 }];
  let finish!: () => void;
  let items!: Row[];
  let setItems!: (fn: (d: Row[]) => void) => void;
  const frames: string[] = [];
  const dispose = createRoot(d => {
    [items, setItems] = createOptimisticStore<Row[]>(
      async draft => {
        await Promise.resolve();
        draft.length = rows.length;
        rows.forEach((row, i) => {
          draft[i] = { ...row };
        });
      },
      [],
      { key }
    );
    const cell: Record<string, unknown> = {};
    snap = () =>
      void frames.push(`${cell.shown} len=${cell.len} first=${cell.first} pending=${cell.pending}`);
    const probe = (name: string, fn: () => unknown) =>
      createRenderEffect(fn, v => void (cell[name] = v));
    probe("shown", () => items.map(r => r.id).join(","));
    probe("len", () => latest(() => items.length));
    probe("first", () => latest(() => items[0]?.id));
    probe("pending", () => isPending(() => items.length));
    return d;
  });
  const remove = action(function* () {
    setItems(draft => {
      draft.shift();
    });
    yield new Promise<void>(resolve => (finish = resolve));
    refresh(items as any);
  });
  return {
    get items() {
      return items;
    },
    frames,
    remove,
    finish: () => finish(),
    setServer: (ids: number[]) => (rows = ids.map(id => ({ id }))),
    dispose
  };
}

/** A frame whose `latest` reads disagree with the rows it shows. */
const torn = (frames: string[]) =>
  frames.filter(f => {
    if (f.startsWith("undefined ")) return false; // the first load
    const [, shown, len, first] = f.match(/^(\S*) len=(\S+) first=(\S+)/)!;
    const ids = shown.split(",");
    return ids.length !== +len || ids[0] !== first;
  });

async function run(key: "id" | null) {
  const h = build(key);
  step();
  await settle();
  expect(h.frames.at(-1)).toBe("1,2,3 len=3 first=1 pending=false");
  h.remove();
  step();
  expect(h.frames.at(-1)).toBe("2,3 len=2 first=2 pending=false");
  refresh(h.items as any);
  step();
  await settle();
  return h;
}

describe("latest() over a folded keyed optimistic store (#5234)", () => {
  it("keeps the shown guess after an outside refresh lands beneath it", async () => {
    const h = await run("id");
    // The refresh is a different truth: isPending says so (D-23), the
    // screen and `latest` keep the guess until the hold commits (D-22, D-34).
    expect(h.frames.at(-1)).toBe("2,3 len=2 first=2 pending=true");
    expect(latest(() => h.items.length)).toBe(2);
    expect(latest(() => h.items[0].id)).toBe(2);
    expect(latest(() => h.items.map(r => r.id).join(","))).toBe("2,3");
    h.finish();
    await settle();
    expect(h.frames.at(-1)).toBe("1,2,3 len=3 first=1 pending=false");
    expect(latest(() => h.items.length)).toBe(3);
    expect(latest(() => h.items[0].id)).toBe(1);
    expect(torn(h.frames)).toEqual([]);
    h.dispose();
  });

  it("key: null is unchanged", async () => {
    const h = await run(null);
    expect(h.frames.at(-1)).toBe("2,3 len=2 first=2 pending=true");
    expect(latest(() => h.items.length)).toBe(2);
    expect(latest(() => h.items[0].id)).toBe(2);
    h.finish();
    await settle();
    expect(h.frames.at(-1)).toBe("1,2,3 len=3 first=1 pending=false");
    expect(latest(() => h.items.length)).toBe(3);
    expect(torn(h.frames)).toEqual([]);
    h.dispose();
  });

  it("a refresh landing after the action settled shows the truth", async () => {
    // A control with no refresh during the action: nothing folds, and the
    // later refresh is a different truth landing on a settled list.
    const h = build("id");
    step();
    await settle();
    h.remove();
    step();
    expect(h.frames.at(-1)).toBe("2,3 len=2 first=2 pending=false");
    h.setServer([2, 3]);
    h.finish();
    await settle();
    expect(h.frames.at(-1)).toBe("2,3 len=2 first=2 pending=false");
    h.setServer([4, 2, 3]);
    refresh(h.items as any);
    step();
    await settle();
    expect(h.frames.at(-1)).toBe("4,2,3 len=3 first=4 pending=false");
    expect(latest(() => h.items.length)).toBe(3);
    expect(latest(() => h.items[0].id)).toBe(4);
    expect(torn(h.frames)).toEqual([]);
    h.dispose();
  });
});

// The same fold over other edits and arrangements: `latest` reads what the
// screen shows at every step and the truth from the commit on.
describe("latest() over a folded keyed optimistic store: edits and arrangements (#5234)", () => {
  type Item = { id: string; v: number };
  const show = (l: Item[]) => l.map(r => r.id + (r.v ? r.v : "")).join("");

  function list(nested: boolean) {
    let server: Item[] = ["a", "b", "c"].map(id => ({ id, v: 0 }));
    let store!: any, set!: (fn: (d: any) => void) => void;
    let screen = "";
    const dispose = createRoot(d => {
      [store, set] = createOptimisticStore<any>(
        async () => {
          await Promise.resolve();
          const rows = server.map(r => ({ ...r }));
          return nested ? { box: { rows } } : rows;
        },
        nested ? { box: { rows: [] } } : [],
        { key: "id" }
      );
      createRenderEffect(
        () => show(nested ? store.box.rows : store),
        v => void (screen = v)
      );
      return d;
    });
    const rows = (): Item[] => (nested ? store.box.rows : store);
    const edit = (fn: (d: Item[]) => void) => set(d => fn(nested ? d.box.rows : d));
    return {
      frame: () => [screen, latest(() => show(rows())), latest(() => rows().length)],
      edit,
      refresh: () => refresh(store),
      setServer: (ids: string[]) => (server = ids.map(id => ({ id, v: 0 }))),
      dispose
    };
  }
  function hold(h: ReturnType<typeof list>, fn: (d: Item[]) => void) {
    let end!: () => void;
    const p = action(function* () {
      h.edit(fn);
      yield new Promise<void>(r => (end = r));
      h.refresh();
    })();
    return { end: () => end(), p };
  }

  for (const nested of [false, true])
    it(`adds, removes and reorders in one guess${nested ? " (nested list)" : ""}`, async () => {
      const h = list(nested);
      await settle();
      expect(h.frame()).toEqual(["abc", "abc", 3]);
      const a = hold(h, d => {
        d.splice(0, 1);
        d.reverse();
        d.push({ id: "X", v: 0 });
      });
      await settle();
      expect(h.frame()).toEqual(["cbX", "cbX", 3]);
      h.setServer(["a", "b", "c", "d"]);
      h.refresh();
      await settle();
      expect(h.frame()).toEqual(["cbX", "cbX", 3]);
      h.setServer(["b", "c", "d", "X"]);
      a.end();
      await a.p;
      await settle();
      expect(h.frame()).toEqual(["bcdX", "bcdX", 4]);
      h.dispose();
    });

  it("two overlapping actions with an outside refresh between them", async () => {
    const h = list(false);
    await settle();
    const a = hold(h, d => void d.splice(0, 1));
    await settle();
    h.setServer(["a", "b", "c", "Y"]);
    h.refresh();
    await settle();
    expect(h.frame()).toEqual(["bc", "bc", 2]);
    const b = hold(h, d => void d.find(r => r.id === "c")!.v++);
    await settle();
    expect(h.frame()).toEqual(["bc1", "bc1", 2]);
    a.end();
    await a.p;
    await settle();
    expect(h.frame()).toEqual(["bc1", "bc1", 2]);
    h.setServer(["b", "c", "Y"]);
    b.end();
    await b.p;
    await settle();
    expect(h.frame()).toEqual(["bcY", "bcY", 3]);
    h.dispose();
  });
});

// `latest` through a folded arrangement reads the rows the guess shows, in
// its order (D-33, D-34); their fields are their own slots and read the
// newest answer, the truth (D-22). Each flush, every `latest` reader shows the
// screen's rows; a derivation outside the lane reads the truth.
describe("latest() over a folded keyed optimistic store: the rows' fields (#5234)", () => {
  type Row = { title: string; children: Row[] } & Record<string, any>;

  function fields(
    keyName: string,
    first: [string, string, string[]?][],
    view: "store" | "projection" | "optimistic" = "store"
  ) {
    const row = ([k, title, kids = []]: [string, string, string[]?]): Row => ({
      [keyName]: k,
      title,
      children: kids.map(c => ({ [keyName]: c, title: c, children: [] }))
    });
    let server = first.map(row);
    const show = (rows: Row[]): string =>
      rows
        .map(
          r => r[keyName] + ":" + r.title + (r.children.length ? "[" + show(r.children) + "]" : "")
        )
        .join(",");
    const seen: Record<string, unknown> = {};
    let store!: Refreshable<Row[]>, set!: (fn: (d: Row[]) => void) => void, get!: () => string;
    let flag!: () => number, setFlag!: (v: number) => void;
    const dispose = createRoot(d => {
      [store, set] = createOptimisticStore<Row[]>(
        async () => {
          await Promise.resolve();
          return JSON.parse(JSON.stringify(server));
        },
        [],
        { key: keyName }
      );
      [flag, setFlag] = createOptimistic(() => 0);
      if (view === "projection") {
        const chain = createProjection<Row[]>(() => store, [], { key: keyName });
        get = () => show(chain);
      } else if (view === "optimistic") {
        const [over] = createOptimistic(() => store);
        get = () => show(over());
      } else get = () => show(store);
      const probe = (name: string, fn: () => unknown) =>
        createRenderEffect(fn, v => void (seen[name] = v));
      probe("screen", get);
      probe("latest", () => latest(get));
      probe("pending", () => isPending(() => store.length));
      probe("flag", () => latest(flag));
      return d;
    });
    const frames: string[] = [];
    const torn: string[] = [];
    // The rows shown, without their fields: "b:B[s:s],c:c" -> "b[s],c".
    const keys = (v: unknown) => String(v).replace(/:[^,[\]]*/g, "");
    const step = () => {
      flush();
      if (seen.screen === undefined || seen.screen === "") return;
      const direct = latest(get);
      if (keys(seen.latest) !== keys(seen.screen) || direct !== seen.latest)
        torn.push(`${seen.screen} | latest ${seen.latest} | direct ${direct}`);
      frames.push(`${seen.screen} pending=${seen.pending}`);
    };
    const settle = async () => {
      for (let i = 0; i < 4; i++) {
        step();
        await tick();
      }
      step();
    };
    const hold = (fn: (d: Row[]) => void, scalar = false) => {
      let end!: () => void;
      const p = action(function* () {
        set(fn);
        if (scalar) setFlag(1);
        yield new Promise<void>(r => (end = r));
        refresh(store);
      })();
      return { end: () => end(), p };
    };
    return {
      settle,
      hold,
      frames,
      torn,
      seen,
      flag: () => latest(flag),
      // A memo outside the lane, born during the fold: it reads the truth.
      offscreen: () =>
        createRoot(d => {
          const v = latest(createMemo(() => show(store)));
          d();
          return v;
        }),
      setServer: (rows: [string, string, string[]?][]) => (server = rows.map(row)),
      refresh: () => refresh(store),
      dispose
    };
  }

  const last = (h: { frames: string[] }) => h.frames.at(-1);

  it("a removal with the truth changing a kept row's field", async () => {
    const h = fields("id", [
      ["a", "A"],
      ["b", "B"]
    ]);
    await h.settle();
    const a = h.hold(d => void d.shift());
    await h.settle();
    expect(last(h)).toBe("b:B pending=false");
    h.setServer([
      ["a", "A"],
      ["b", "Server B"]
    ]);
    h.refresh();
    await h.settle();
    expect(last(h)).toBe("b:B pending=true");
    expect(h.seen.latest).toBe("b:Server B");
    expect(h.offscreen()).toBe("a:A,b:Server B");
    h.setServer([["b", "Server B"]]);
    a.end();
    await a.p;
    await h.settle();
    expect(last(h)).toBe("b:Server B pending=false");
    expect(h.torn).toEqual([]);
    h.dispose();
  });

  it("the guess and the truth both add the same key", async () => {
    const h = fields("id", [
      ["a", "A"],
      ["b", "B"]
    ]);
    await h.settle();
    const a = h.hold(d => void d.unshift({ id: "x", title: "Saving", children: [] }));
    await h.settle();
    expect(last(h)).toBe("x:Saving,a:A,b:B pending=false");
    h.setServer([
      ["y", "Y"],
      ["x", "Saved"],
      ["a", "A"],
      ["b", "B"]
    ]);
    h.refresh();
    await h.settle();
    expect(last(h)).toBe("x:Saving,a:A,b:B pending=true");
    expect(h.seen.latest).toBe("x:Saved,a:A,b:B");
    a.end();
    await a.p;
    await h.settle();
    expect(last(h)).toBe("y:Y,x:Saved,a:A,b:B pending=false");
    expect(h.torn).toEqual([]);
    h.dispose();
  });

  it("nested keyed lists", async () => {
    const h = fields("id", [
      ["a", "a", ["p", "q"]],
      ["b", "b", ["r", "s"]],
      ["c", "c"]
    ]);
    await h.settle();
    const a = h.hold(d => {
      d.shift();
      d[0].children.shift();
    });
    await h.settle();
    expect(last(h)).toBe("b:b[s:s],c:c pending=false");
    h.setServer([
      ["b", "B", ["r", "t"]],
      ["a", "A", ["q"]],
      ["d", "d"]
    ]);
    h.refresh();
    await h.settle();
    expect(last(h)).toBe("b:b[s:s],c:c pending=true");
    expect(h.seen.latest).toBe("b:B[s:s],c:c");
    a.end();
    await a.p;
    await h.settle();
    expect(last(h)).toBe("b:B[r:r,t:t],a:A[q:q],d:d pending=false");
    expect(h.torn).toEqual([]);
    h.dispose();
  });

  for (const view of ["projection", "optimistic"] as const)
    it(`read through ${view === "projection" ? "a chained projection" : "createOptimistic over the store"}`, async () => {
      const h = fields(
        "id",
        [
          ["a", "A"],
          ["b", "B"]
        ],
        view
      );
      await h.settle();
      const a = h.hold(d => void d.shift());
      await h.settle();
      expect(h.seen.screen).toBe("b:B");
      h.setServer([
        ["a", "A"],
        ["b", "Server B"]
      ]);
      h.refresh();
      await h.settle();
      expect(h.seen.screen).toBe("b:B");
      a.end();
      await a.p;
      await h.settle();
      expect(h.seen.screen).toBe("a:A,b:Server B");
      expect(h.torn).toEqual([]);
      h.dispose();
    });

  it("a key other than id", async () => {
    const h = fields("code", [
      ["a", "A"],
      ["b", "B"]
    ]);
    await h.settle();
    const a = h.hold(d => void d.shift());
    await h.settle();
    h.setServer([
      ["a", "A"],
      ["b", "Server B"]
    ]);
    h.refresh();
    await h.settle();
    expect(last(h)).toBe("b:B pending=true");
    a.end();
    await a.p;
    await h.settle();
    expect(last(h)).toBe("a:A,b:Server B pending=false");
    expect(h.torn).toEqual([]);
    h.dispose();
  });

  it("a second guess after the refresh", async () => {
    const h = fields("id", [
      ["a", "A"],
      ["b", "B"]
    ]);
    await h.settle();
    const a = h.hold(d => void d.shift());
    await h.settle();
    h.setServer([
      ["a", "A"],
      ["b", "Server B"]
    ]);
    h.refresh();
    await h.settle();
    expect(last(h)).toBe("b:B pending=true");
    const b = h.hold(d => {
      d[0].title = "second";
      d.unshift({ id: "x", title: "X", children: [] });
    });
    await h.settle();
    expect(last(h)).toBe("x:X,b:second pending=true");
    a.end();
    await a.p;
    await h.settle();
    h.setServer([
      ["x", "X"],
      ["a", "A"],
      ["b", "second"]
    ]);
    b.end();
    await b.p;
    await h.settle();
    expect(last(h)).toBe("x:X,a:A,b:second pending=false");
    expect(h.torn).toEqual([]);
    h.dispose();
  });

  // D-34 decision 3: a scalar guess written in the same action as a folded
  // keyed removal reads the guess (1) through `latest` too, not the truth (0).
  it("a scalar guess in the same action keeps its guess", async () => {
    const h = fields("id", [
      ["a", "A"],
      ["b", "B"]
    ]);
    await h.settle();
    const a = h.hold(d => void d.shift(), true);
    await h.settle();
    expect([h.flag(), h.seen.flag]).toEqual([1, 1]);
    h.setServer([
      ["a", "A"],
      ["b", "Server B"]
    ]);
    h.refresh();
    await h.settle();
    expect(last(h)).toBe("b:B pending=true");
    expect([h.flag(), h.seen.flag]).toEqual([1, 1]);
    a.end();
    await a.p;
    await h.settle();
    expect(last(h)).toBe("a:A,b:Server B pending=false");
    expect([h.flag(), h.seen.flag]).toEqual([0, 0]);
    expect(h.torn).toEqual([]);
    h.dispose();
  });
});

// The hold lands nothing on a leaf `latest` read through the fold: the
// action's closing refresh of a second store lands after the first store's
// answer, so the first store's rows were staged in a flush the hold stayed
// blocked through. Its `latest` render effect re-runs at the commit anyway,
// onto the truth's new arrangement.
describe("latest() over a folded keyed optimistic store: a commit that lands nothing on the rows (#5234)", () => {
  type Row = { id: string; title: string };
  const show = (rows: Row[]) => rows.map(r => r.id + ":" + r.title).join(",");

  function store(first: [string, string][]) {
    let server = first;
    const seen: Record<string, string> = {};
    let rows!: Row[], set!: (fn: (d: Row[]) => void) => void;
    const dispose = createRoot(d => {
      [rows, set] = createOptimisticStore<Row[]>(
        async () => {
          await Promise.resolve();
          return server.map(([id, title]) => ({ id, title }));
        },
        [],
        { key: "id" }
      );
      createRenderEffect(
        () => show(rows),
        v => void (seen.screen = v)
      );
      createRenderEffect(
        () => latest(() => show(rows)),
        v => void (seen.latest = v)
      );
      return d;
    });
    return {
      seen,
      set: (fn: (d: Row[]) => void) => set(fn),
      refresh: () => refresh(rows as any),
      setServer: (s: [string, string][]) => (server = s),
      dispose
    };
  }

  for (const otherGuesses of [true, false])
    it(`a second store refreshed at the action's end${otherGuesses ? ", both guessing" : ""}`, async () => {
      const h = store([
        ["a", "A"],
        ["b", "B"]
      ]);
      const k = store([
        ["p", "P"],
        ["q", "Q"]
      ]);
      await settle();
      let end!: () => void;
      const p = action(function* () {
        h.set(d => void d.shift());
        if (otherGuesses) k.set(d => void d.pop());
        yield new Promise<void>(r => (end = r));
        h.refresh();
        k.refresh();
      })();
      await settle();
      h.setServer([
        ["a", "A"],
        ["b", "Server B"]
      ]);
      k.setServer([
        ["p", "Server P"],
        ["q", "Q"]
      ]);
      h.refresh();
      k.refresh();
      await settle();
      expect(h.seen).toEqual({ screen: "b:B", latest: "b:Server B" });
      h.setServer([
        ["c", "C"],
        ["b", "Server B"]
      ]);
      k.setServer([["p", "Server P"]]);
      end();
      await p;
      await settle();
      expect(h.seen).toEqual({ screen: "c:C,b:Server B", latest: "c:C,b:Server B" });
      expect(k.seen).toEqual({ screen: "p:Server P", latest: "p:Server P" });
      h.dispose();
      k.dispose();
    });
});

describe("latest() over a folded keyed optimistic store: the guess's scope (#5234)", () => {
  // D-22: only the guessed arrangement shows the guess; a slot of the same
  // store that shows no guess (a sibling list, a field, a kept row's field)
  // reads the truth that landed.
  type Kid = { id: string; label: string };
  type Row = { id: string; label: string; kids: Kid[] };
  type Doc = { rows: Row[]; other: Kid[]; title: string };
  const show = (l: Kid[]) => l.map(r => r.id + ":" + r.label).join(",");

  function scope() {
    let server: Doc = {
      rows: [
        { id: "a", label: "A", kids: [] },
        { id: "b", label: "B", kids: [{ id: "p", label: "P" }] }
      ],
      other: [{ id: "x", label: "X" }],
      title: "T"
    };
    const seen: Record<string, unknown> = {};
    let doc!: Doc, set!: (fn: (d: Doc) => void) => void;
    let captured!: () => { removed: Row; kept: Row };
    const dispose = createRoot(d => {
      [doc, set] = createOptimisticStore<Doc>(
        async () => {
          await Promise.resolve();
          return JSON.parse(JSON.stringify(server));
        },
        { rows: [], other: [], title: "" },
        { key: "id" }
      );
      const probe = (name: string, fn: () => unknown) => {
        createRenderEffect(fn, v => void (seen[name] = v));
        createRenderEffect(
          () => latest(fn),
          v => void (seen["L." + name] = v)
        );
      };
      probe("rows", () => show(doc.rows));
      probe("other", () => show(doc.other));
      probe("title", () => doc.title);
      probe("kid", () => doc.rows.find(r => r.id === "b")?.kids[0]?.label);
      return d;
    });
    const direct = (rows: { removed: Row; kept: Row }) => ({
      rows: latest(() => show(doc.rows)),
      other: latest(() => show(doc.other)),
      title: latest(() => doc.title),
      removed: latest(() => rows.removed.label),
      kept: latest(() => rows.kept.label),
      kid: latest(() => rows.kept.kids[0].label)
    });
    captured = () => ({ removed: doc.rows[0], kept: doc.rows[1] });
    return {
      seen,
      direct,
      captured,
      set: (fn: (d: Doc) => void) => set(fn),
      refresh: () => refresh(doc as any),
      setServer: (s: Doc) => (server = s),
      dispose
    };
  }

  for (const closing of [true, false])
    it(`a sibling list, a scalar field and a removed row read the truth${closing ? " (closing refresh)" : ""}`, async () => {
      const h = scope();
      await settle();
      const rows = h.captured();
      let end!: () => void;
      const p = action(function* () {
        h.set(d => void d.rows.shift());
        yield new Promise<void>(r => (end = r));
        if (closing) h.refresh();
      })();
      await settle();
      expect(h.seen).toMatchObject({ rows: "b:B", "L.rows": "b:B" });
      h.setServer({
        rows: [
          { id: "a", label: "sA", kids: [] },
          { id: "b", label: "sB", kids: [{ id: "p", label: "sP" }] }
        ],
        other: [
          { id: "y", label: "sY" },
          { id: "x", label: "sX" }
        ],
        title: "sT"
      });
      h.refresh();
      await settle();
      // The fold: the guessed list's rows keep the screen; the rest, the
      // kept row's fields included, reads the truth.
      expect(h.direct(rows)).toEqual({
        rows: "b:sB",
        other: "y:sY,x:sX",
        title: "sT",
        removed: "sA",
        kept: "sB",
        kid: "sP"
      });
      expect(h.seen).toEqual({
        rows: "b:B",
        "L.rows": "b:sB",
        other: "x:X",
        "L.other": "y:sY,x:sX",
        title: "T",
        "L.title": "sT",
        kid: "P",
        "L.kid": "sP"
      });
      if (closing)
        h.setServer({
          rows: [{ id: "b", label: "cB", kids: [{ id: "p", label: "cP" }] }],
          other: [
            { id: "y", label: "sY" },
            { id: "x", label: "sX" }
          ],
          title: "sT"
        });
      end();
      await p;
      await settle();
      const rowsShown = closing ? "b:cB" : "a:sA,b:sB";
      const kid = closing ? "cP" : "sP";
      expect(h.seen).toEqual({
        rows: rowsShown,
        "L.rows": rowsShown,
        other: "y:sY,x:sX",
        "L.other": "y:sY,x:sX",
        title: "sT",
        "L.title": "sT",
        kid,
        "L.kid": kid
      });
      expect(h.direct(rows)).toMatchObject({
        rows: rowsShown,
        other: "y:sY,x:sX",
        title: "sT",
        kept: closing ? "cB" : "sB",
        kid
      });
      h.dispose();
    });
});

describe("latest() over a folded keyed optimistic store: a record's key node in the lane (#5234)", () => {
  // A record's structure-version node is guessed in the folded lane when the
  // same setter adds a key to it (thin.ts `put`): it is not a list, so no
  // read through it is a read through a shown arrangement.
  type Kid = { id: string; label: string };
  type Doc = { rows: Kid[]; other: Kid[]; extra?: number };
  const show = (l: Kid[]) => l.map(r => r.id + ":" + r.label).join(",");

  for (const order of ["key first", "list first"])
    it(`a key added to the store's root beside the list guess (${order})`, async () => {
      let server: Doc = {
        rows: [
          { id: "a", label: "A" },
          { id: "b", label: "B" }
        ],
        other: [{ id: "x", label: "X" }]
      };
      const seen: Record<string, unknown> = {};
      let doc!: Doc, set!: (fn: (d: Doc) => void) => void;
      const dispose = createRoot(d => {
        [doc, set] = createOptimisticStore<Doc>(
          async () => {
            await Promise.resolve();
            return JSON.parse(JSON.stringify(server));
          },
          { rows: [], other: [] },
          { key: "id" }
        );
        createRenderEffect(
          () => show(doc.rows),
          v => void (seen.rows = v)
        );
        // The root's key node exists: its reader reads the root's keys.
        createRenderEffect(
          () => Object.keys(doc).join(),
          v => void (seen.keys = v)
        );
        createRenderEffect(
          () => latest(() => show(doc.other)),
          v => void (seen.other = v)
        );
        return d;
      });
      await settle();
      let end!: () => void;
      const p = action(function* () {
        set(d => {
          if (order === "key first") d.extra = 1;
          d.rows.shift();
          if (order === "list first") d.extra = 1;
        });
        yield new Promise<void>(r => (end = r));
      })();
      await settle();
      // The truth echoes the added key, so the list's truth folds beneath.
      server = {
        rows: [
          { id: "a", label: "sA" },
          { id: "b", label: "sB" }
        ],
        other: [
          { id: "y", label: "sY" },
          { id: "x", label: "sX" }
        ],
        extra: 1
      };
      refresh(doc as any);
      await settle();
      expect(seen.rows).toBe("b:B");
      expect(latest(() => show(doc.rows))).toBe("b:sB");
      expect(latest(() => doc.other.length)).toBe(2);
      expect(latest(() => show(doc.other))).toBe("y:sY,x:sX");
      expect(seen.other).toBe("y:sY,x:sX");
      end();
      await p;
      await settle();
      expect(seen).toEqual({ rows: "a:sA,b:sB", keys: "rows,other,extra", other: "y:sY,x:sX" });
      dispose();
    });
});

describe("latest() over a folded keyed optimistic store: an unrelated action (#5234, F-6)", () => {
  type Item = { id: string; label: string };

  /** Action X removes a row; an outside refresh folds a changed truth
   * beneath it. A binding reads the folded rows and an unrelated memo `y`
   * through `latest`; action Y sets `y`'s query, whose fetch is `fetchY`. */
  function scene(fault?: () => boolean) {
    let server = "B";
    const fetchY = Promise.withResolvers<string>();
    const endX = Promise.withResolvers<void>(),
      endY = Promise.withResolvers<void>();
    const shown: boolean[] = [];
    const bound: string[] = [];
    let runs = 0;
    let rows!: Item[];
    let setRows!: (fn: (d: Item[]) => void) => void;
    let setQuery!: (v: boolean) => void;
    const dispose = createRoot(d => {
      [rows, setRows] = createOptimisticStore(
        async () => [
          { id: "a", label: "A" },
          { id: "b", label: server }
        ],
        [] as Item[]
      );
      const [query, set] = createSignal(false);
      setQuery = set;
      const y = createMemo(() => (query() ? fetchY.promise : "y0"));
      const labels = () => rows.map(r => r.label).join(",");
      createRenderEffect(labels, () => {});
      createRenderEffect(query, v => void shown.push(v));
      createRenderEffect(
        () => (runs++, latest(labels) + "/" + latest(y)),
        v => void bound.push(v)
      );
      if (fault) {
        // A second kept reader that also reads a source that throws.
        const failing = createMemo(() => {
          if (fault()) throw new Error("fault");
          return "";
        });
        const combined = createMemo(() => latest(labels) + "/" + latest(y) + failing());
        createEffect(combined, { effect: () => {}, error: () => {} });
      }
      return d;
    });
    return {
      shown,
      bound,
      runs: () => runs,
      fetchY,
      async fold() {
        await settle();
        const x = action(function* () {
          setRows(d => void d.shift());
          yield endX.promise;
        })();
        await settle();
        server = "S";
        refresh(rows as any); // outside: the truth folds beneath the removal guess
        await settle();
        return { x };
      },
      startY() {
        return action(function* () {
          setQuery(true);
          yield endY.promise;
        })();
      },
      endX: () => endX.resolve(),
      endY: () => endY.resolve(),
      dispose
    };
  }

  it("a binding reading folded rows does not hold an unrelated action's flight", async () => {
    const h = scene();
    const { x } = await h.fold();
    expect(h.bound.at(-1)).toBe("S/y0");
    const y = h.startY();
    await settle();
    h.endY();
    await y;
    await settle();
    // Y ended; its fetch is pending, read only through `latest`
    // (display-ahead) by the shared binding: nothing holds `query = true`.
    expect(h.shown.at(-1)).toBe(true);
    h.fetchY.resolve("y1");
    await settle();
    expect(h.shown.at(-1)).toBe(true);
    expect(h.bound.at(-1)).toBe("S/y1");
    const before = h.bound.length,
      runs = h.runs();
    h.endX();
    await x;
    await settle();
    // The commit re-runs the binding once, onto the truth.
    expect(h.bound.slice(before)).toEqual(["A,S/y1"]);
    expect(h.runs() - runs).toBe(1);
    h.dispose();
  });

  it("the folded hold lands first: the binding is computed once", async () => {
    const h = scene();
    const { x } = await h.fold();
    const y = h.startY();
    await settle();
    const before = h.bound.length,
      runs = h.runs();
    h.endX();
    await x;
    await settle();
    expect(h.bound.slice(before)).toEqual(["A,S/y0"]);
    expect(h.runs() - runs).toBe(1);
    h.endY();
    await y;
    await settle();
    expect(h.shown.at(-1)).toBe(true);
    h.fetchY.resolve("y1");
    await settle();
    expect(h.bound.at(-1)).toBe("A,S/y1");
    h.dispose();
  });

  it("a kept reader whose other source errored does not hold an unrelated flight", async () => {
    const [broken, setBroken] = createSignal(false);
    const h = scene(broken);
    const { x } = await h.fold();
    const y = h.startY();
    await settle();
    setBroken(true);
    await settle();
    h.endX();
    await x;
    await settle();
    h.endY();
    await y;
    await settle();
    // Y's write shows when Y ends, its fetch still pending (F-6).
    expect(h.shown.at(-1)).toBe(true);
    h.fetchY.resolve("y1");
    await settle();
    expect(h.shown.at(-1)).toBe(true);
    h.dispose();
  });
});

describe("latest() over a folded keyed optimistic store: shared rows, the seat shadow (#5234)", () => {
  type Item = { id: string; label: string };

  // One raw row in two lists shares one proxy and one field node: the
  // guessed list keeps its rows, and the field reads the truth through
  // either list, whichever reached the row first (D-22, D-33).
  for (const siblingFirst of [true, false])
    it(`a row shared with a sibling list (${siblingFirst ? "sibling" : "guessed list"} read first)`, async () => {
      let server = "B";
      const seen: Record<string, unknown> = {};
      let doc!: { rows: Item[]; sibling: Item[] };
      let set!: (fn: (d: { rows: Item[]; sibling: Item[] }) => void) => void;
      const dispose = createRoot(d => {
        [doc, set] = createOptimisticStore(
          async () => {
            const b = { id: "b", label: server };
            return { rows: [{ id: "a", label: "A" }, b], sibling: [b] };
          },
          { rows: [] as Item[], sibling: [] as Item[] }
        );
        const show = (l: Item[]) => l.map(r => r.id + ":" + r.label).join(",");
        const sibling = () =>
          createRenderEffect(
            () => latest(() => show(doc.sibling)),
            v => void (seen.sibling = v)
          );
        if (siblingFirst) sibling();
        createRenderEffect(
          () => show(doc.rows),
          v => void (seen.screen = v)
        );
        createRenderEffect(
          () => latest(() => show(doc.rows)),
          v => void (seen.rows = v)
        );
        if (!siblingFirst) sibling();
        return d;
      });
      await settle();
      expect(doc.rows[1]).toBe(doc.sibling[0]);
      let end!: () => void;
      const p = action(function* () {
        set(d => void d.rows.shift());
        yield new Promise<void>(r => (end = r));
      })();
      await settle();
      server = "S";
      refresh(doc as any);
      await settle();
      expect(doc.rows[0]).toBe(doc.sibling[0]);
      expect(seen).toEqual({ screen: "b:B", rows: "b:S", sibling: "b:S" });
      expect(latest(() => doc.rows.length)).toBe(1);
      expect(latest(() => doc.rows[0].label)).toBe("S");
      end();
      await p;
      await settle();
      expect(seen).toEqual({ screen: "a:A,b:S", rows: "a:A,b:S", sibling: "b:S" });
      dispose();
    });

  it("the seat shadow predicts every folded read", async () => {
    (globalThis as any).__SEAT_SHADOW_STRICT__ = true;
    try {
      let server = "B";
      const seen: Record<string, unknown> = {};
      let rows!: Item[], set!: (fn: (d: Item[]) => void) => void;
      const dispose = createRoot(d => {
        [rows, set] = createOptimisticStore(
          async () => [
            { id: "a", label: "A" },
            { id: "b", label: server }
          ],
          [] as Item[]
        );
        const show = () => rows.map(r => r.id + ":" + r.label).join(",");
        createRenderEffect(show, v => void (seen.screen = v));
        createRenderEffect(
          () => latest(show),
          v => void (seen.latest = v)
        );
        return d;
      });
      await settle();
      let end!: () => void;
      const p = action(function* () {
        set(d => void d.shift());
        yield new Promise<void>(r => (end = r));
      })();
      await settle();
      server = "S";
      refresh(rows as any);
      await settle();
      expect(seen).toEqual({ screen: "b:B", latest: "b:S" });
      end();
      await p;
      await settle();
      expect(seen).toEqual({ screen: "a:A,b:S", latest: "a:A,b:S" });
      dispose();
    } finally {
      (globalThis as any).__SEAT_SHADOW_STRICT__ = false;
    }
  });
});

// The truth waits beneath a keyed list's guess, so a memo over the list reads
// the rows shown, as a direct read does (D-22, D-34).
describe("latest() over a folded keyed optimistic store: memos, other guesses (#5234)", () => {
  type Item = { id: string };
  const ids = (l: Item[]) => l.map(r => r.id).join(",");

  function lane() {
    let list = ["a", "b", "c"],
      slots = ["x", "y"],
      title = "T",
      flagTruth = 0;
    const seen: Record<string, unknown> = {};
    let items!: Item[], setItems!: (fn: (d: Item[]) => void) => void;
    let nul!: Item[], setNul!: (fn: (d: Item[]) => void) => void;
    let doc!: { title: string }, setDoc!: (fn: (d: { title: string }) => void) => void;
    let flag!: () => number, setFlag!: (v: number) => void;
    const dispose = createRoot(d => {
      [items, setItems] = createOptimisticStore<Item[]>(
        async () => (await Promise.resolve(), list.map(id => ({ id }))),
        [],
        { key: "id" }
      );
      [nul, setNul] = createOptimisticStore<Item[]>(
        async () => (await Promise.resolve(), slots.map(id => ({ id }))),
        [],
        { key: null }
      );
      [doc, setDoc] = createOptimisticStore<{ title: string }>(
        async () => (await Promise.resolve(), { title }),
        { title: "" }
      );
      [flag, setFlag] = createOptimistic(async () => (await Promise.resolve(), flagTruth));
      // Each binding: the screen, a direct `latest`, and `latest` of a memo.
      const bind = (name: string, fn: () => unknown) => {
        const m = createMemo(fn);
        createRenderEffect(fn, v => void (seen[name] = v));
        createRenderEffect(
          () => latest(fn),
          v => void (seen[name + "/latest"] = v)
        );
        createRenderEffect(
          () => latest(m),
          v => void (seen[name + "/memo"] = v)
        );
      };
      bind("items", () => ids(items));
      bind("nul", () => ids(nul));
      bind("title", () => doc.title);
      bind("flag", () => flag());
      return d;
    });
    /** The bindings whose `latest` reads disagree with the screen. */
    const stale = () =>
      ["items", "nul", "title", "flag"].filter(
        n => seen[n + "/latest"] !== seen[n] || seen[n + "/memo"] !== seen[n]
      );
    return {
      seen,
      stale,
      get items() {
        return items;
      },
      setItems: (fn: (d: Item[]) => void) => setItems(fn),
      guessOthers() {
        setNul(d => void d.pop());
        setDoc(d => void (d.title = "guess"));
        setFlag(1);
      },
      changeServer() {
        list = ["z", "a", "b", "c"];
        slots = ["x", "y", "w"];
        title = "T2";
        flagTruth = 5;
      },
      dispose
    };
  }

  it("a memo over the list reads the shown rows", async () => {
    (globalThis as any).__SEAT_SHADOW_STRICT__ = true;
    try {
      const h = lane();
      await settle();
      let end!: () => void;
      const p = action(function* () {
        h.setItems(d => void d.shift());
        yield new Promise<void>(r => (end = r));
      })();
      await settle();
      const shown = "b,c";
      expect(h.seen).toMatchObject({ items: shown, "items/latest": shown, "items/memo": shown });
      // An untracked memo read before the fold, as well as the bound ones.
      const len = createRoot(() => createMemo(() => h.items.length));
      expect(latest(len)).toBe(2);
      h.changeServer();
      refresh(h.items as any);
      await settle();
      expect(h.seen).toMatchObject({ items: shown, "items/latest": shown, "items/memo": shown });
      expect([latest(len), latest(() => h.items.length)]).toEqual([2, 2]);
      expect(isPending(() => h.items.length)).toBe(true);
      end();
      await p;
      await settle();
      const truth = "z,a,b,c";
      expect(h.seen).toMatchObject({ items: truth, "items/latest": truth, "items/memo": truth });
      expect(latest(len)).toBe(4);
      expect(h.stale()).toEqual([]);
      h.dispose();
    } finally {
      (globalThis as any).__SEAT_SHADOW_STRICT__ = false;
    }
  });

  // The action's other guesses share the folded lane and keep their guess
  // until the hold commits; with no closing refresh (or a rejection) the
  // commit lands each one's truth, and every `latest` reader follows.
  for (const ending of ["ends without a refresh", "rejects"] as const)
    it(`other guesses in the action, which ${ending}`, async () => {
      const h = lane();
      await settle();
      let end!: (ok: boolean) => void;
      const p = action(function* () {
        h.setItems(d => void d.shift());
        h.guessOthers();
        if (!(yield new Promise<boolean>(r => (end = r)))) throw new Error("rejected");
      })().catch(() => {});
      await settle();
      const guessed = { nul: "x", title: "guess", flag: 1 };
      expect(h.seen).toMatchObject(guessed);
      expect(h.stale()).toEqual([]);
      h.changeServer();
      refresh(h.items as any);
      await settle();
      expect(h.seen).toMatchObject({ items: "b,c", ...guessed });
      expect(h.stale()).toEqual([]);
      end(ending === "ends without a refresh");
      await p;
      await settle();
      // The list's truth is the refresh's; the others' guesses revert.
      expect(h.seen).toMatchObject({
        items: "z,a,b,c",
        nul: "x,y",
        title: "T",
        flag: 0
      });
      expect(h.stale()).toEqual([]);
      h.dispose();
    });
});

// A `key: null` list has no fold: a different truth corrects its lane, so a
// derivation over the list re-derives on the truth while the screen keeps the
// guess, and a request that depends on it starts when the truth lands, not
// when the action ends (D-34).
describe("a key: null optimistic store: a downstream request (#5234, D-34)", () => {
  it("starts when the outside refresh lands, before the action ends", async () => {
    let server = ["a", "b", "c"];
    let screen: [number, number] | undefined;
    const asked: number[] = [];
    let reply!: () => void, end!: () => void;
    const replied = new Promise<void>(r => (reply = r));
    let rows!: { id: string }[], setRows!: (fn: (d: { id: string }[]) => void) => void;
    const dispose = createRoot(d => {
      [rows, setRows] = createOptimisticStore<{ id: string }[]>(
        async () => (await Promise.resolve(), server.map(id => ({ id }))),
        [],
        { key: null }
      );
      const query = createMemo(async () => {
        const len = rows.length;
        asked.push(len);
        if (len === 4) await replied;
        return len;
      });
      createRenderEffect(
        () => [rows.length, query()] as [number, number],
        v => void (screen = v)
      );
      return d;
    });
    await settle();
    expect(screen).toEqual([3, 3]);
    const p = action(function* () {
      setRows(d => void d.shift());
      yield new Promise<void>(r => (end = r));
    })();
    await settle();
    expect(screen).toEqual([2, 2]);
    server = ["a", "b", "c", "d"];
    refresh(rows as any);
    await settle();
    // The screen keeps the guess; the request for the truth is already out.
    expect(screen).toEqual([2, 2]);
    expect(asked).toEqual([3, 2, 4]);
    reply();
    await settle();
    expect(screen).toEqual([2, 2]);
    end();
    await p;
    await settle();
    expect(screen).toEqual([4, 4]);
    expect(asked).toEqual([3, 2, 4]);
    dispose();
  });
});
