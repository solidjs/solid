import {
  createEffect,
  createMemo,
  createProjection,
  createRenderEffect,
  createRoot,
  createSignal,
  createStore,
  flush,
  getOwner,
  isPending,
  latest,
  mapArray
} from "../src/index.js";

function gc() {
  return new Promise(resolve =>
    setTimeout(async () => {
      flush(); // flush call stack (holds a reference)
      global.gc!();
      resolve(void 0);
    }, 0)
  );
}

if (global.gc) {
  it("should gc computed if there are no observers", async () => {
    const [$x] = createSignal(0),
      ref = new WeakRef(createMemo(() => $x()));

    await gc();
    expect(ref.deref()).toBeUndefined();
  });

  it("should _not_ gc computed if there are observers", async () => {
    let [$x] = createSignal(0),
      pointer;

    const ref = new WeakRef((pointer = createMemo(() => $x())));

    ref.deref()!();

    await gc();
    expect(ref.deref()).toBeDefined();

    pointer = undefined;
    await gc();
    expect(ref.deref()).toBeUndefined();
  });

  it("should gc root if disposed", async () => {
    let [$x] = createSignal(0),
      ref!: WeakRef<any>,
      pointer;

    const dispose = createRoot(dispose => {
      ref = new WeakRef(
        (pointer = createMemo(() => {
          $x();
        }))
      );

      return dispose;
    });

    await gc();
    expect(ref.deref()).toBeDefined();

    dispose();
    await gc();
    expect(ref.deref()).toBeDefined();

    pointer = undefined;
    await gc();
    expect(ref.deref()).toBeUndefined();
  });

  it("should gc effect lazily", async () => {
    let [$x, setX] = createSignal(0),
      ref!: WeakRef<any>;

    const dispose = createRoot(dispose => {
      createEffect($x, () => {
        ref = new WeakRef(getOwner()!);
      });

      return dispose;
    });

    await gc();
    expect(ref.deref()).toBeDefined();

    dispose();
    setX(1);

    await gc();
    expect(ref.deref()).toBeUndefined();
  });

  // #3351: a live keyed projection must not retain deleted rows through its
  // leaf nodes. Deleting a key drops the readers, the readers drop the
  // nodes, and the nodes leave the projection's firewall child chain — so
  // the row objects (and the nested objects nodes last served) are collectable
  // while the projection itself stays alive.
  it("keyed projection releases deleted rows while it stays live", async () => {
    type Row = { id: string; pos: { x: number } };
    const N = 200;
    const [rows, setRows] = createSignal<Row[]>([]);
    const refs: WeakRef<object>[] = [];
    const { record, dispose } = createRoot(dispose => {
      const record = createProjection<Record<string, Row>>(
        draft => {
          const seen = new Set<string>();
          for (const r of rows()) {
            seen.add(r.id);
            if (draft[r.id] !== r) draft[r.id] = r;
          }
          for (const k of Object.keys(draft)) if (!seen.has(k)) delete draft[k];
        },
        {},
        { key: null }
      );
      const ids = createMemo(() => Object.keys(record));
      createMemo(
        mapArray(ids, id => {
          createRenderEffect(
            () => record[id]?.pos.x,
            () => {}
          );
          return id;
        })
      )();
      return { record, dispose };
    });
    flush();
    setRows(
      Array.from({ length: N }, (_, i) => {
        const r: Row = { id: "n" + i, pos: { x: i } };
        refs.push(new WeakRef(r), new WeakRef(r.pos));
        return r;
      })
    );
    flush();
    await gc();
    expect(refs.filter(r => r.deref() === undefined)).toHaveLength(0);

    setRows([]);
    flush();
    await gc();
    expect(Object.keys(record)).toEqual([]);
    expect(refs.filter(r => r.deref() !== undefined)).toHaveLength(0);
    dispose();
  });

  // #3503: a projection leaf read only through latest()/isPending() joins the
  // projection's `_companionChildren` set. The unobserved sweep drops the leaf
  // from the store cache and the firewall child chain, but the set kept it —
  // and with it the leaf's last value — for the projection's lifetime.
  for (const mode of ["latest", "isPending"] as const) {
    it(`releases an obsolete leaf value after a ${mode}() reader is disposed (#3503)`, async () => {
      const fixture = createRoot(dispose => {
        const [state, setState] = createStore(() => {}, {} as { value?: object }, {
          shallow: true
        });
        return { state, setState, dispose };
      });
      const ref = (() => {
        const value = { old: true };
        fixture.setState(draft => {
          draft.value = value;
        });
        flush();
        return new WeakRef(value);
      })();

      const disposeReader = createRoot(dispose => {
        const read = () => Boolean(fixture.state.value);
        createEffect(
          () => (mode === "latest" ? latest(read) : isPending(read)),
          () => {}
        );
        return dispose;
      });
      flush();
      disposeReader();
      flush();
      fixture.setState(draft => {
        delete draft.value;
      });
      flush();

      await gc();
      await gc();
      expect("value" in fixture.state).toBe(false);
      expect(ref.deref()).toBeUndefined();
      fixture.dispose();
    });
  }
} else {
  it("", () => {});
}
