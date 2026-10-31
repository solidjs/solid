/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// #4542: a pending async memo nothing reads holds no boundary (F-2 Reader),
// also when its subtree mounts under a held update and an inner Show's
// condition reads a memo.
import { describe, expect, test } from "vitest";
import { render } from "@solidjs/web";
import { createMemo, createSignal, type JSX, Loading, Show } from "solid-js";

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

type Shape = "held + memo condition" | "not held" | "held + when={true}";

async function navigate(shape: Shape): Promise<string> {
  const [path, setPath] = createSignal("a");
  const matched = createMemo(() => {
    const p = path();
    return p === "a" || shape === "not held" ? p : wait(10).then(() => p);
  });

  function Page() {
    const local = createMemo(() => 1);
    createMemo(() => (local(), new Promise<never>(() => {})));
    return <p>B</p>;
  }
  function Boundary(props: { children: JSX.Element }) {
    const cond = createMemo(() => undefined as boolean | undefined);
    return (
      <Loading fallback={<i>inner</i>}>
        <Show when={shape === "held + when={true}" ? true : (cond() ?? true)}>
          {props.children}
        </Show>
      </Loading>
    );
  }

  const el = document.createElement("div");
  const dispose = render(
    () => (
      <Loading fallback="root">
        <Show when={matched() === "b"} fallback={<p>A</p>}>
          <Boundary>
            <Page />
          </Boundary>
        </Show>
      </Loading>
    ),
    el
  );
  await wait(30);
  expect(el.textContent).toBe("A");
  setPath("b");
  await wait(100);
  const text = el.textContent ?? "";
  dispose();
  return text;
}

// The same mount whose page reads an async memo: the read holds, the
// unread one never did (frames unchanged by the fix).
async function navigateRead(shape: Shape): Promise<string[]> {
  const [path, setPath] = createSignal("a");
  const matched = createMemo(() => {
    const p = path();
    return p === "a" || shape === "not held" ? p : wait(10).then(() => p);
  });
  function Page() {
    const local = createMemo(() => 1);
    const d = createMemo(() => (local(), wait(40).then(() => "D")));
    return <p>B{d()}</p>;
  }
  const el = document.createElement("div");
  const dispose = render(
    () => (
      <Loading fallback="root">
        <Show when={matched() === "b"} fallback={<p>A</p>}>
          <Page />
        </Show>
      </Loading>
    ),
    el
  );
  await wait(30);
  setPath("b");
  const frames: string[] = [el.textContent!];
  for (let i = 0; i < 24; i++) {
    await wait(5);
    const t = el.textContent!;
    if (frames[frames.length - 1] !== t) frames.push(t);
  }
  dispose();
  return frames;
}

describe("#4542 unread pending memo under a held mount", () => {
  test.each<Shape>(["not held", "held + when={true}", "held + memo condition"])(
    "%s: a pending memo nothing reads does not hold the page's <Loading>",
    async shape => {
      expect(await navigate(shape)).toBe("B");
    }
  );

  test("held: a page that reads an async memo still holds the navigation until it lands", async () => {
    expect(await navigateRead("held + memo condition")).toEqual(["A", "BD"]);
  });
});
