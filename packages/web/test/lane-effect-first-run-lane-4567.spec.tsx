/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
import { expect, test } from "vitest";
import {
  Errored,
  Loading,
  Show,
  action,
  createEffect,
  createMemo,
  createOptimistic,
  createRenderEffect,
  createSignal,
  flush,
  isPending,
  latest
} from "solid-js";
import { render } from "../src/index.js";

const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const strip = (html: string) => html.replace(/<!--[^>]*-->/g, "");

// An effect born on mainline whose first pass reads a held lane's value is
// that lane's work: its first run is released at the lane's reveal with the
// rest of the lane's frame, not at the mount flush while the screen still
// shows the old value (F-7, F-6). Its first run goes to its own pass's lane.
test("a mainline effect reading a held lane runs at the lane's reveal, with its frame", async () => {
  const root = document.createElement("div");
  const [b, setB] = createOptimistic(0);
  const [show, setShow] = createSignal(false);
  let gate!: () => void;
  const goB = action(function* () {
    setB(1);
    yield new Promise<void>(r => (gate = r));
  });
  const slowB = createMemo(() => (b() === 0 ? 0 : wait(40).then(() => b())));
  const log: [string, number, string][] = [];
  function Child() {
    createRenderEffect(
      () => b(),
      x => void log.push(["render", x, strip(root.innerHTML)])
    );
    createEffect(
      () => b(),
      x => void log.push(["user", x, strip(root.innerHTML)])
    );
    return <i>c{b()}</i>;
  }
  const dispose = render(
    () => (
      <Loading fallback="L">
        <p>{slowB()}</p>
        <Show when={show()}>
          <Child />
        </Show>
      </Loading>
    ),
    root
  );
  flush();
  expect(strip(root.innerHTML)).toBe("<p>0</p>");

  goB();
  flush();
  setShow(true);
  flush();
  await wait(5);
  flush();
  // Mounted while B's guess waits on its derivation: nothing of the lane's
  // world has shown, so no effect has run on `1`.
  expect(log.filter(([, x]) => x === 1)).toEqual([]);

  await wait(60);
  flush();
  // The reveal: the lane's runs, with the screen that shows `1`.
  expect(log).toEqual([
    ["render", 0, "<p>0</p>"],
    ["user", 1, "<p>1</p><i>c0</i>"],
    ["render", 1, "<p>1</p><i>c0</i>"]
  ]);
  gate();
  await wait(5);
  flush();
  dispose();
});

// A verdict hole under `<Errored>` in a view a `latest` guard opens: while
// the action holds, the hole shows the verdict (`true`), never an empty slot
// (F-2), and it keeps tracking after the landing.
for (const wrap of [false, true])
  test(`a verdict hole ${wrap ? "under Errored " : ""}shows the verdict through the hold`, async () => {
    const [s, setS] = createSignal(0);
    let release!: () => void;
    const go = action(function* () {
      setS(3);
      yield new Promise<void>(r => (release = r));
    });
    const el = document.createElement("div");
    const body = () => <b>{String(isPending(() => s()))}</b>;
    const dispose = render(
      () => (
        <Show when={latest(s)} fallback="F">
          {wrap ? <Errored fallback="E">{body()}</Errored> : body()}
        </Show>
      ),
      el
    );
    flush();
    const frames = [el.innerHTML];
    go();
    flush();
    await wait(5);
    flush();
    frames.push(el.innerHTML);
    release();
    await wait(5);
    flush();
    frames.push(el.innerHTML);
    setS(4);
    flush();
    frames.push(el.innerHTML);
    dispose();
    expect(frames.map(strip)).toEqual(["F", "<b>true</b>", "<b>false</b>", "<b>false</b>"]);
  });
