/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// #3462: a jsdom port of the issue's playground (delays scaled 1000ms -> 100ms).
// Repeating `setShow(true)` while the first write is held on `selected`'s
// flight — a flight the `setA(1)` re-ask has since superseded — published
// `Show: true` beside `Panel: hidden`; Panel caught up seconds later.
import { expect, test } from "vitest";
import { createMemo, createSignal, flush } from "solid-js";
import { render } from "@solidjs/web";

const delay = <T = void,>(ms: number, value?: T) => new Promise<T>(r => setTimeout(r, ms, value));
const snap = (div: HTMLElement) =>
  Array.from(div.querySelectorAll("p"))
    .map(p => p.textContent)
    .join(" | ");

function App(props: { repeat: boolean }) {
  const [a, setA] = createSignal(0);
  const [b, setB] = createSignal(0);
  const [show, setShow] = createSignal(false);
  const details = createMemo(() => delay(200, a()));
  const selected = createMemo(() => delay(200, a() + b() + details()));
  return (
    <>
      <button
        onClick={async () => {
          setB(1);
          await delay(50);
          setShow(true);
          await delay(50);
          setA(1);
          await delay(50);
          if (props.repeat) setShow(true);
        }}
      >
        Run
      </button>
      <p>Show: {String(show())}</p>
      <p>Panel: {show() ? selected() : "hidden"}</p>
    </>
  );
}

async function run(repeat: boolean) {
  const div = document.createElement("div");
  document.body.appendChild(div);
  const dispose = render(() => <App repeat={repeat} />, div);
  try {
    await delay(500);
    flush();
    expect(snap(div)).toBe("Show: false | Panel: hidden");
    div.querySelector("button")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const frames: string[] = [];
    for (let t = 0; t <= 800; t += 25) {
      flush();
      const f = snap(div);
      if (frames[frames.length - 1] !== f) frames.push(f);
      await delay(25);
    }
    return frames;
  } finally {
    dispose();
    div.remove();
  }
}

test("A15 / #3462 repeating a held write while its conditional's source is re-asked keeps it held", async () => {
  expect(await run(true)).toEqual(["Show: false | Panel: hidden", "Show: true | Panel: 3"]);
});

test("A15 / #3462 control: without the repeated write both publish at the chain's landing", async () => {
  expect(await run(false)).toEqual(["Show: false | Panel: hidden", "Show: true | Panel: 3"]);
});
