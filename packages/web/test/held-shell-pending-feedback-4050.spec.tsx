/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// #4050: a Provider's children are one memo. A router shell `[<Feedback/>,
// outlet]` under it reads the held outlet and the feedback `Show` together;
// the feedback is a display-ahead read (F-6) and shows now, beside the held
// page — as it does without the Provider.
import { expect, test } from "vitest";
import { Show, createContext, createMemo, createSignal, flush, isPending, latest } from "solid-js";
import { render } from "../src/index.js";
const tick = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
  flush();
};

for (const provider of [true, false])
  test(`held navigation shows delayed feedback beside the old page${provider ? " under a Provider" : ""}`, async () => {
    const container = document.createElement("div");
    const Ctx = createContext(0);
    const [route, setRoute] = createSignal(0);
    let release!: () => void;
    const page = createMemo(async () => {
      const r = route();
      if (r) await new Promise<void>(res => (release = res));
      return `page ${r}`;
    });
    const [elapsed, setElapsed] = createSignal(false);
    const Feedback = () => (
      <Show when={isPending(page) && latest(elapsed)}>
        <b>waiting</b>
      </Show>
    );
    const Outlet = () => <Show when={page()}>{p => <p>{p()}</p>}</Show>;
    const Shell = () => [<Feedback />, <Outlet />];
    render(() => (provider ? <Ctx value={1}>{<Shell />}</Ctx> : <Shell />), container);
    await tick();
    expect(container.innerHTML).toBe("<p>page 0</p>");
    setRoute(1);
    flush();
    await tick();
    expect(container.innerHTML).toBe("<p>page 0</p>");
    setElapsed(true);
    flush();
    await tick();
    expect(container.innerHTML).toBe("<b>waiting</b><p>page 0</p>");
    setElapsed(false);
    release();
    await tick();
    expect(container.innerHTML).toBe("<p>page 1</p>");
  });
