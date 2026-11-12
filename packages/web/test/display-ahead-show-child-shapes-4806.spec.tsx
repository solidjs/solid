/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
import { test, expect } from "vitest";
import { Show, createMemo, createSignal, latest, flush } from "solid-js";
import { render } from "../src/index.js";
const tick = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};
const shapes: Record<string, (id: () => number) => any> = {
  element: id => (
    <Show when={latest(id) > 0} fallback="[none]">
      <span>{id()}</span>
    </Show>
  ),
  text: id => (
    <Show when={latest(id) > 0} fallback="[none]">
      {id()}
    </Show>
  ),
  "text beside a hole": id => (
    <Show when={latest(id) > 0} fallback="[none]">
      id {id()}
    </Show>
  ),
  fragment: id => (
    <Show when={latest(id) > 0} fallback="[none]">
      <>{id()}</>
    </Show>
  ),
  "ternary text": id => <>{latest(id) > 0 ? id() : "[none]"}</>,
  "ternary element": id => <>{latest(id) > 0 ? <span>{id()}</span> : "[none]"}</>,
  "function child": id => (
    <Show when={latest(id) > 0} fallback="[none]">
      {() => <span>{id()}</span>}
    </Show>
  )
};
for (const [name, shape] of Object.entries(shapes))
  test(`#4806 a display-ahead Show's content is born held: ${name}`, async () => {
    const asks = new Map<string, (v: any) => void>();
    const ask = (key: string) => new Promise<any>(res => asks.set(key, res));
    const c = document.body.appendChild(document.createElement("div"));
    let setId!: (v: number) => void;
    const dispose = render(() => {
      const [id, set] = createSignal(0);
      setId = set;
      const detail = createMemo(() => ask("d:" + id()));
      return (
        <>
          {id()} {detail()} {shape(id)}
        </>
      );
    }, c);
    await tick();
    asks.get("d:0")!("d0");
    await tick();
    const loaded = c.textContent;
    setId(1);
    await tick();
    const held = c.textContent;
    asks.get("d:1")!("d1");
    await tick();
    const landed = c.textContent;
    dispose();
    c.remove();
    expect([loaded, held, landed]).toEqual(["0 d0 [none]", "0 d0 [none]", landed]);
    expect(landed!.startsWith("1 d1 ")).toBe(true);
  });
