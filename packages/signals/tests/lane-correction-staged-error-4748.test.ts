// #4748: a guess on `createOptimistic` over an async source, then the
// guessing action's own refresh fails. The refresh's failure is the list's
// answer (F-11 / D-41). The lane's correction voids its derivations; a staged
// error is one of them, so it must not commit the empty staging as the
// node's error (the boundary's fallback saw `undefined`, threw, and halted).
import {
  action,
  createErrorBoundary,
  createLoadingBoundary,
  createMemo,
  createOptimistic,
  createRenderEffect,
  mapArray,
  createRoot,
  createSignal,
  flush,
  refresh,
  untrack
} from "../src/index.js";
const tick = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};
it.each(["derived", "direct", "memo"])(
  "a guess over %s truth, then its own refresh fails: the error reaches the boundary",
  async shape => {
    const asks: { key: string; res: (v: any) => void; rej: (e: any) => void }[] = [];
    const ask = (key: string) => new Promise<any>((res, rej) => asks.push({ key, res, rej }));
    const pick = (key: string) =>
      asks.splice(
        asks.findIndex(a => a.key === key),
        1
      )[0];
    let assign!: (id: number) => any;
    let out = "";
    const server = [
      { id: 1, a: "-" },
      { id: 3, a: "-" }
    ];
    createRoot(() => {
      const [filter] = createSignal("open");
      const list = createMemo(() => ask(`fetch:${filter()}`));
      const truth =
        shape === "derived"
          ? createSignal(() => (list() as any[]).map(x => ({ ...x })))[0]
          : shape === "memo"
            ? createMemo(() => (list() as any[]).map(x => ({ ...x })))
            : list;
      const [rows, setRows] = createOptimistic(() => truth());
      assign = action(function* (id: number) {
        setRows((rs: any[]) => rs.map(r => (r.id === id ? { ...r, a: "guest" } : r)));
        yield ask(`assign:${id}`);
        refresh(list);
        if (truth !== list) refresh(truth);
      });
      createRenderEffect(
        createLoadingBoundary(
          () =>
            createErrorBoundary(
              () => {
                const mapped = mapArray(rows as any, (r: any) =>
                  createMemo(() => `[#${r.id} ${r.a}]`)
                );
                return createMemo(() =>
                  mapped()
                    .map((f: any) => f())
                    .join("")
                );
              },
              (e: any) => `list error: ${e().message}`
            ),
          () => "loading",
          { on: filter }
        ),
        v => void (out = String(typeof v === "function" ? (v as any)() : v))
      );
    });
    await tick();
    pick("fetch:open").res(server.map(x => ({ ...x })));
    await tick();
    expect(out).toBe("[#1 -][#3 -]");
    assign(1);
    await tick();
    expect(out).toBe("[#1 guest][#3 -]");
    server[0].a = "guest";
    pick("assign:1").res({});
    await tick();
    expect(out).toBe("[#1 guest][#3 -]");
    pick("fetch:open").rej(new Error("down"));
    await tick();
    expect(out).toBe("list error: down");
  }
);
