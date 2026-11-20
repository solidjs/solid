/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// #5092: a display-ahead gate (`latest(() => s()) > 0`) whose branch reads a
// pending `a` is born held (S-46, S-58), beside a `latest(() => s())` text and,
// in the "both" shapes, a plain `<Show when={s() > 0}>`. `<Show>` and the
// ternary that `lowerShow` makes of it give one screen: the fallback stays,
// never the branch with its hole empty (F-2), and the verdict lane that
// opened the mount reveals with the landing (lanes.ts `lanesBlocked`).
import { describe, expect, test } from "vitest";
import { createMemo, createSignal, Errored, flush, latest, Loading, Show } from "solid-js";
import { render } from "../src/index.js";

const settle = async () => {
  for (let i = 0; i < 3; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

type Form = "Show" | "ternary";
type Shape = "both" | "gate" | "both-siblings" | "gate-siblings";

async function run(form: Form, shape: Shape) {
  let setS!: (v: number) => void;
  const resolvers: (() => void)[] = [];
  function App() {
    const [s, set] = createSignal(1);
    setS = set;
    const a = createMemo(() => {
      const v = s();
      return new Promise<string>(r => resolvers.push(() => r("a" + v)));
    });
    const plain = () =>
      form === "Show" ? (
        <Show when={s() > 0} fallback={<p>[plain off] </p>}>
          <p>[plain on {a()}] </p>
        </Show>
      ) : s() > 0 ? (
        <p>[plain on {a()}] </p>
      ) : (
        <p>[plain off] </p>
      );
    const text = () => <p>[latest {latest(() => s())}] </p>;
    const gate = () =>
      form === "Show" ? (
        <Show when={latest(() => s()) > 0} fallback={<p>[gate off]</p>}>
          <p>[gate on {a()}]</p>
        </Show>
      ) : latest(() => s()) > 0 ? (
        <p>[gate on {a()}]</p>
      ) : (
        <p>[gate off]</p>
      );
    const both = shape === "both" || shape === "both-siblings";
    // Siblings directly under `<Loading>`, or a fragment as its only child
    // (the position `lowerShow` lowers).
    return (
      <Errored fallback={<p>error</p>}>
        {shape.endsWith("siblings") ? (
          <Loading fallback={<p>loading</p>}>
            {both && plain()}
            {text()}
            {gate()}
          </Loading>
        ) : (
          <Loading fallback={<p>loading</p>}>
            <>
              {both && plain()}
              {text()}
              {gate()}
            </>
          </Loading>
        )}
      </Errored>
    );
  }
  const c = document.createElement("div");
  const dispose = render(() => <App />, c);
  const land = async () => {
    while (resolvers.length) resolvers.shift()!();
    await settle();
  };
  await land();
  setS(0);
  await land();
  const off = c.textContent;
  setS(2);
  await settle();
  const held = c.textContent;
  await land();
  const landed = c.textContent;
  dispose();
  return [off, held, landed];
}

for (const form of ["Show", "ternary"] as Form[])
  describe(`#5092 display-ahead gate, ${form}`, () => {
    test("gate beside a latest() text", async () => {
      expect(await run(form, "gate")).toEqual([
        "[latest 0] [gate off]",
        "[latest 0] [gate off]",
        "[latest 2] [gate on a2]"
      ]);
    });
    test("gate beside a latest() text, siblings", async () => {
      expect(await run(form, "gate-siblings")).toEqual([
        "[latest 0] [gate off]",
        "[latest 0] [gate off]",
        "[latest 2] [gate on a2]"
      ]);
    });
    test("plain Show, latest() text and gate", async () => {
      expect(await run(form, "both")).toEqual([
        "[plain off] [latest 0] [gate off]",
        "[plain off] [latest 0] [gate off]",
        "[plain on a2] [latest 2] [gate on a2]"
      ]);
    });
    test("plain Show, latest() text and gate, siblings", async () => {
      expect(await run(form, "both-siblings")).toEqual([
        "[plain off] [latest 0] [gate off]",
        "[plain off] [latest 0] [gate off]",
        "[plain on a2] [latest 2] [gate on a2]"
      ]);
    });
  });
