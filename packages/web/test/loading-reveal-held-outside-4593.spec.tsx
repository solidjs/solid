/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * #4593 (F-7, F-1, D-12): a first-load `<Loading>` whose content derives from
 * a write still held outside it. `a` and `s` are read outside the boundary,
 * `b` inside; `setS(1)` is held on `a:1`. When `b:1` lands, `b=21` is the
 * answer for `s = 1` — it belongs to that hold and reveals with its commit,
 * never beside `s=0`. The boundary keeps its fallback until then.
 */
import { render } from "../src/index.js";
import { createMemo, createSignal, Errored, flush, Loading } from "solid-js";
import { expect, it } from "vitest";

const tick = async () => {
  for (let i = 0; i < 2; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

it("a first-load <Loading> does not reveal content derived from a write still held outside it", async () => {
  const flights = new Map<string, (v: number) => void>();
  const ask = (key: string) => new Promise<number>(resolve => flights.set(key, resolve));
  const [s, setS] = createSignal(0);
  const el = document.createElement("div");
  const frames: string[] = [];
  const dispose = render(() => {
    const a = createMemo(() => ask("a:" + s()));
    const b = createMemo(() => ask("b:" + s()));
    return (
      <Errored fallback={<p>error</p>}>
        <p>a={a()}</p>
        <p>s={s()}</p>
        <Loading fallback={<p>loading b</p>}>
          <p>b={b()}</p>
        </Loading>
      </Errored>
    );
  }, el);
  await tick();
  flights.get("a:0")!(10);
  await tick();
  frames.push(el.textContent!);
  setS(1);
  flush();
  await tick();
  frames.push(el.textContent!);
  flights.get("b:1")!(21);
  await tick();
  frames.push(el.textContent!);
  flights.get("a:1")!(11);
  await tick();
  frames.push(el.textContent!);
  dispose();
  expect(frames).toEqual([
    "a=10s=0loading b",
    "a=10s=0loading b",
    "a=10s=0loading b",
    "a=11s=1b=21"
  ]);
});

it("the first-load content reveals at once when its answer is for the committed frame", async () => {
  const flights = new Map<string, (v: number) => void>();
  const ask = (key: string) => new Promise<number>(resolve => flights.set(key, resolve));
  const [s] = createSignal(0);
  const el = document.createElement("div");
  const frames: string[] = [];
  const dispose = render(() => {
    const a = createMemo(() => ask("a:" + s()));
    const b = createMemo(() => ask("b:" + s()));
    return (
      <>
        <p>a={a()}</p>
        <Loading fallback={<p>loading b</p>}>
          <p>b={b()}</p>
        </Loading>
      </>
    );
  }, el);
  await tick();
  flights.get("a:0")!(10);
  await tick();
  frames.push(el.textContent!);
  flights.get("b:0")!(20);
  await tick();
  frames.push(el.textContent!);
  dispose();
  expect(frames).toEqual(["a=10loading b", "a=10b=20"]);
});
