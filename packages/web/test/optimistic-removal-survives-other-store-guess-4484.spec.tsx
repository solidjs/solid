/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
/**
 * #4484: a keyed derived optimistic store whose derive awaits its fetch, and
 * an unkeyed detail store. A pending close guesses #3's removal from the
 * list. A second action then guesses on the detail store only — and the list
 * showed #3 again. The list derive's writes after its `await` (write-override
 * writes, notified at once) left the list's target listed for notification;
 * the detail setter's exit then notified the list's staged landing as the
 * user's own edit, and it became guesses over the close's removal.
 *
 * Ruled: a guess holds until its own refresh answers it (F-11, D-33, D-35);
 * a guess on another store does not touch it. The list stays `[#1][#4]`.
 */
import { expect, test } from "vitest";
import {
  For,
  Loading,
  Errored,
  action,
  createOptimisticStore,
  createMemo,
  flush,
  refresh,
  untrack
} from "solid-js";
import { render } from "../src/index.js";

const tick = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

test("#4484: a pending removal guess survives another action's guess on another store", async () => {
  const asks: { key: string; res: (v: any) => void }[] = [];
  const ask = (key: string) => new Promise<any>(res => asks.push({ key, res }));
  const settle = async (key: string, v: any) => {
    const i = asks.findIndex(a => a.key === key);
    asks.splice(i, 1)[0].res(v);
    await tick();
  };
  const container = document.body.appendChild(document.createElement("div"));
  const seen: string[] = [];
  const observer = new MutationObserver(() => seen.push(container.textContent!));
  observer.observe(container, { childList: true, subtree: true, characterData: true });
  // The detail has loaded (the action guesses on it only then).
  let detailShown = false;
  let rename!: (id: number, t: string) => any;
  let closeOne!: (id: number) => any;
  const dispose = render(() => {
    const [issues, set] = createOptimisticStore(
      async (d: any[]) => {
        const r = await ask("issues");
        d.length = r.length;
        r.forEach((x: any, i: number) => {
          d[i] = x;
        });
      },
      [] as any[],
      { key: "id" }
    );
    const detailQ = createMemo(() => ask("detail"));
    const [detail, setDetail] = createOptimisticStore(async (d: any) => {
      Object.assign(d, detailQ());
    }, {} as any);
    // Guesses the detail only.
    rename = action(function* (id: number, t: string) {
      if (detailShown && untrack(() => detail.id) === id)
        setDetail((d: any) => {
          d.title = t;
        });
      yield ask(`rename:${id}`);
      refresh(issues);
    });
    // Removes the row by guess.
    closeOne = action(function* (id: number) {
      const next = untrack(() => issues.filter((x: any) => x.id !== id));
      set((d: any) => {
        d.length = next.length;
        next.forEach((x: any, i: number) => {
          d[i] = x;
        });
      });
      yield ask(`close:${id}`);
      refresh(issues);
    });
    return (
      <>
        <Loading fallback={<p>loading</p>}>
          <For each={issues}>
            {(it: any) => (
              <i>
                [#{it.id} {it.title}]
              </i>
            )}
          </For>
        </Loading>
        {" | "}
        <Loading fallback={<p>loading detail</p>}>
          <Errored fallback={() => <p>err</p>}>
            <u>
              #{detail.id} {detail.title}
            </u>
          </Errored>
        </Loading>
      </>
    );
  }, container);
  try {
    await tick();
    const rows = (t3: string) => [
      { id: 1, title: "Login" },
      { id: 3, title: t3 },
      { id: 4, title: "Typo" }
    ];
    await settle("issues", rows("Crash"));
    expect(container.textContent).toBe("[#1 Login][#3 Crash][#4 Typo] | loading detail");
    rename(3, "Alpha");
    await tick();
    closeOne(3);
    await tick();
    expect(container.textContent).toBe("[#1 Login][#4 Typo] | loading detail");
    await settle("rename:3", {});
    await settle("detail", { id: 3, title: "Alpha" });
    // The rename's refresh: the server has not closed #3 yet.
    await settle("issues", rows("Alpha"));
    expect(container.textContent).toBe("[#1 Login][#4 Typo] | #3 Alpha");
    detailShown = true;
    const from = seen.length;
    // A guess on the detail store only.
    rename(3, "Alpha");
    await tick();
    expect(container.textContent).toBe("[#1 Login][#4 Typo] | #3 Alpha");
    await settle("close:3", {});
    expect(container.textContent).toBe("[#1 Login][#4 Typo] | #3 Alpha");
    // #3 never came back while the close's guess held.
    expect(seen.slice(from).filter(s => s.includes("[#3"))).toEqual([]);
  } finally {
    observer.disconnect();
    dispose();
    container.remove();
  }
});
