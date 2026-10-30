import { expect, it } from "vitest";
import {
  action,
  createEffect,
  createMemo,
  createOptimisticStore,
  createRoot,
  createSignal,
  createStore,
  flush,
  isPending,
  refresh
} from "../src/index.js";

// D-41: an error is an answer, and at its reveal the effect's error arm runs
// once. A derived store's readers are not the derive's dependents: the
// family hands them the derive's error (projection.ts `errorFamily`). A
// second hand-off of the same error — the derive re-run against it in a
// later pass — must not re-run a reader that already shows it (#4457 review).
const tick = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

function harness(
  kind: "optimistic" | "store",
  form: "memo-async" | "memo-sync",
  probePending: boolean
) {
  const asks: { key: string; res: (v: any) => void; rej: (e: any) => void }[] = [];
  const ask = (key: string) => new Promise<any>((res, rej) => asks.push({ key, res, rej }));
  const settle = async (key: string, f: (a: (typeof asks)[number]) => void) => {
    for (const a of asks.filter(a => a.key === key)) {
      asks.splice(asks.indexOf(a), 1);
      f(a);
    }
    await tick();
  };
  const frames: string[] = [];
  let setFilter!: (f: string) => void;
  let add!: (id: number) => any;
  createRoot(() => {
    const [filter, sf] = createSignal("open");
    setFilter = sf;
    const m = createMemo(() => ask(`f:${filter()}`));
    const write = (d: any[], r: any) => {
      d.length = 0;
      d.push(...r.map((x: any) => ({ ...x })));
    };
    const make: any = kind === "store" ? createStore : createOptimisticStore;
    const [issues, set] = make(
      form === "memo-sync"
        ? (d: any[]) => {
            write(d, m());
          }
        : async (d: any[]) => {
            write(d, m());
          },
      [],
      { key: "id" }
    );
    add = action(function* (id: number) {
      set((d: any[]) => {
        d.push({ id });
      });
      yield ask(`add:${id}`);
      refresh(issues);
    });
    createEffect(
      () =>
        (issues as any[]).map(i => `#${i.id}`).join(" ") +
        (probePending ? ` p=${isPending(() => (issues as any[]).length)}` : ""),
      {
        effect: (v: string) => {
          frames.push(v);
        },
        error: (e: any) => {
          frames.push(`ERR ${e?.message ?? e}`);
        }
      } as any
    );
  });
  return { frames, settle, setFilter: (f: string) => setFilter(f), add: (id: number) => add(id) };
}

it("an optimistic store over a failing memo, with an action's guess in flight, delivers the error once at the reveal", async () => {
  const { frames, settle, setFilter, add } = harness("optimistic", "memo-sync", false);
  await tick();
  await settle("f:open", a => a.res([{ id: 1 }, { id: 3 }]));
  add(9);
  await tick();
  frames.push("--added");
  setFilter("closed");
  flush();
  await tick();
  await settle("f:closed", a => a.rej(new Error("timeout")));
  // Held with the action's guess (D-41): no arm yet.
  frames.push("--rejected");
  await settle("add:9", a => a.res({}));
  frames.push("--action-done");
  setFilter("open");
  flush();
  await tick();
  await settle("f:open", a => a.res([{ id: 1 }, { id: 4 }]));
  expect(frames).toEqual([
    "#1 #3",
    "#1 #3 #9",
    "--added",
    "--rejected",
    "ERR timeout",
    "--action-done",
    "#1 #4"
  ]);
});

for (const kind of ["optimistic", "store"] as const)
  it(`${kind === "store" ? "a createStore(fn)" : "an optimistic store's"} async derive over a failing memo, read beside isPending, delivers the error once`, async () => {
    const { frames, settle, setFilter } = harness(kind, "memo-async", true);
    await tick();
    await settle("f:open", a => a.res([{ id: 1 }, { id: 3 }]));
    setFilter("closed");
    flush();
    await tick();
    await settle("f:closed", a => a.rej(new Error("timeout")));
    frames.push("--rejected");
    setFilter("open");
    flush();
    await tick();
    await settle("f:open", a => a.res([{ id: 1 }, { id: 4 }]));
    expect(frames).toEqual([
      "#1 #3 p=false",
      "#1 #3 p=true",
      "ERR timeout",
      "--rejected",
      "#1 #4 p=false"
    ]);
  });

// The dedupe compares an errored reader's error: a clean reader is never
// taken for one that already shows an `undefined` rejection.
for (const kind of ["optimistic", "store"] as const)
  for (const sync of [true, false])
    it(`${kind === "store" ? "a createStore(fn)" : "an optimistic store's"} ${sync ? "sync" : "async"} derive failing with undefined still reaches its reader`, async () => {
      const log: string[] = [];
      let set!: (v: number) => void;
      createRoot(() => {
        const [n, s] = createSignal(0);
        set = s;
        const make: any = kind === "store" ? createStore : createOptimisticStore;
        const [st] = make(
          sync
            ? (d: any) => {
                if (n()) throw undefined;
                d.v = n();
              }
            : async (d: any) => {
                const v = n();
                await Promise.resolve();
                if (v) return Promise.reject();
                d.v = v;
              },
          { v: -1 }
        );
        createEffect(() => (st as any).v, {
          effect: (v: any) => {
            log.push(`v ${v}`);
          },
          error: (e: any) => {
            log.push(`ERR ${e}`);
          }
        } as any);
      });
      await tick();
      set(1);
      flush();
      await tick();
      expect(log).toEqual(["v 0", "ERR undefined"]);
    });
