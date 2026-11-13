// #4834: a memo over a shown guess and an async source (`heading`) rendered
// empty when the source landed while another action's `refresh()` was out.
// The memo's pass over the answer is the guess lane's work; the lane was held
// because a list row of it waited on that re-ask, so the heading's binding
// read the memo's committed value — derived before the source had answered —
// beside a sibling showing the answer. A member waiting on re-asks only keeps
// what it shows, and a `refresh()` holds nothing new (D-34 ¶3): it no longer
// keeps the lane's other work off the screen. The DOM version is
// packages/web/test/blank-heading-4834.spec.tsx.
import { test, expect } from "vitest";
import {
  action,
  createLoadingBoundary,
  createMemo,
  createOptimistic,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  mapArray,
  refresh
} from "../src/index.js";

const tick = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

for (const withOther of [true, false])
  test(`#4834 a heading over a guess shows it when its source lands (other action: ${withOther})`, async () => {
    const asks: { key: string; res: (v: any) => void }[] = [];
    const ask = (key: string) => new Promise<any>(res => asks.push({ key, res }));
    const pick = (key: string) => {
      const i = asks.findIndex(a => a.key === key);
      if (i < 0) throw new Error("no ask " + key + " in " + asks.map(a => a.key));
      return asks.splice(i, 1)[0];
    };
    const screen: { list?: any; detail?: any } = {};
    let setSelected!: (v: boolean) => void;
    let rename!: (t: string) => void, other!: () => void;
    let dispose!: () => void;
    createRoot(d => {
      dispose = d;
      const [selected, setSel] = createSignal(false);
      setSelected = setSel;
      const [renamesT] = createSignal<string[]>(() => []);
      const [renames, guessRename] = createOptimistic(() => renamesT());
      const list = createMemo(() => ask("list"));
      const rows = createMemo(() =>
        (list() as any[]).map(i => ({
          id: i.id,
          title: renames().reduce((t: string, r: string) => r, i.title)
        }))
      );
      const detail = createMemo(() => (selected() ? ask("detail") : null));
      const heading = createMemo(() => {
        const d: any = detail();
        return d == null ? "" : renames().reduce((t: string, r: string) => r, d.title);
      });
      rename = action(function* (title: string) {
        guessRename((rs: string[]) => [...rs, title]);
        yield ask("rename");
        refresh(list);
        refresh(detail);
      });
      other = action(function* () {
        yield ask("other");
        refresh(list);
      });
      // <Loading><ul><For each={rows()}>{it => <li>{it.title}</li>}</For></ul></Loading>
      const lb = createLoadingBoundary(
        () =>
          mapArray(
            () => rows(),
            (it: any) => {
              const li = { text: "" };
              createRenderEffect(
                () => it.title,
                v => void (li.text = v)
              );
              return li;
            }
          ),
        () => "loading"
      );
      createRenderEffect(
        () => {
          const v: any = lb();
          return typeof v === "function" ? v().map((li: any) => li) : v;
        },
        v => void (screen.list = v)
      );
      // <Show when={selected()} fallback="select"><Loading fallback="loading detail">
      //   <h2>{heading()}</h2><p>{detail()?.body}</p></Loading></Show>
      const when = createMemo(() => selected());
      createRenderEffect(
        () =>
          when()
            ? createLoadingBoundary(
                () => {
                  const h2 = { text: "" },
                    p = { text: "" };
                  createRenderEffect(
                    () => heading(),
                    v => void (h2.text = v)
                  );
                  createRenderEffect(
                    () => (detail() as any)?.body,
                    v => void (p.text = v)
                  );
                  return [h2, p];
                },
                () => "loading detail"
              )
            : () => "select",
        b => void (screen.detail = b)
      );
      return undefined;
    });
    const view = () => {
      const l = screen.list,
        d = screen.detail?.();
      const show = (v: any) => (typeof v === "string" ? v : v?.map((x: any) => x.text).join(","));
      return `${show(l)} | ${show(d)}`;
    };
    const steps: (() => void)[] = [
      () => pick("list").res([{ id: 2, title: "Old bug" }]),
      () => setSelected(true),
      () => withOther && other(),
      () => rename("Delta"),
      // re-asks the list
      () => withOther && pick("other").res({}),
      () => pick("detail").res({ title: "Old bug", body: "long gone" })
    ];
    const frames: string[] = [];
    for (const f of steps) {
      f();
      await tick();
      frames.push(view());
    }
    expect(frames).toEqual([
      "Old bug | select",
      "Old bug | loading detail",
      "Old bug | loading detail",
      "Delta | loading detail",
      "Delta | loading detail",
      "Delta | Delta,long gone"
    ]);
    dispose();
  });
