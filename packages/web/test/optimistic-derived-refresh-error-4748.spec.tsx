/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// #4748: the signal-form sibling of #4737. A guess on `createOptimistic` over
// a derived signal, then the guessing action's own refresh fails: the
// refresh's failure is the list's answer (F-11 / D-41), so it reaches Errored.
import { expect, test } from "vitest";
import {
  Loading,
  Errored,
  For,
  action,
  createOptimistic,
  createMemo,
  createSignal,
  flush,
  refresh
} from "solid-js";
import { render } from "../src/index.js";

const tick = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

test("a guess over a derived signal, then its own refresh fails: the error shows", async () => {
  const asks: { key: string; res: (v: any) => void; rej: (e: any) => void }[] = [];
  const ask = (key: string) => new Promise<any>((res, rej) => asks.push({ key, res, rej }));
  const pick = (key: string) =>
    asks.splice(
      asks.findIndex(a => a.key === key),
      1
    )[0];
  const c = document.body.appendChild(document.createElement("div"));
  let assign!: (id: number) => any;
  const server = [
    { id: 1, a: "-" },
    { id: 3, a: "-" }
  ];
  const dispose = render(() => {
    const [filter] = createSignal("open");
    const list = createMemo(() => ask(`fetch:${filter()}`));
    const [truth] = createSignal(() => (list() as any[]).map(x => ({ ...x })));
    const [rows, setRows] = createOptimistic(() => truth());
    assign = action(function* (id: number) {
      setRows((rs: any[]) => rs.map(r => (r.id === id ? { ...r, a: "guest" } : r)));
      yield ask(`assign:${id}`);
      refresh(list);
      refresh(truth);
    });
    return (
      <Loading on={filter()} fallback={<i>loading</i>}>
        <Errored fallback={(e: any) => <b>list error: {e().message}</b>}>
          <For each={rows()}>
            {(r: any) => (
              <i>
                [#{r.id} {r.a}]
              </i>
            )}
          </For>
        </Errored>
      </Loading>
    );
  }, c);
  await tick();
  pick("fetch:open").res(server.map(x => ({ ...x })));
  await tick();
  expect(c.textContent).toBe("[#1 -][#3 -]");
  assign(1);
  await tick();
  expect(c.textContent).toBe("[#1 guest][#3 -]");
  server[0].a = "guest";
  pick("assign:1").res({});
  await tick();
  expect(c.textContent).toBe("[#1 guest][#3 -]");
  pick("fetch:open").rej(new Error("down"));
  await tick();
  expect(c.textContent).toBe("list error: down");
  dispose();
  c.remove();
});
