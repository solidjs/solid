/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */

import { expect, it } from "vitest";
import { createMemo, createSignal, Loading, Show } from "solid-js";
import { render } from "@solidjs/web";

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

// #4541: b's first flight is superseded by a synchronous recompute (the value is
// written and its source bumped before the first promise's continuation reaches
// the core, the order data libraries use) while a sibling a refetches under the
// same <Loading>. Once both settle the boundary must reveal (F-1, D-14).
async function run(refetchA: boolean): Promise<string> {
  const [aVersion, setAVersion] = createSignal(0);
  const [bVersion, setBVersion] = createSignal(0);
  let aFlight: Promise<string> | null = null;
  let releaseA: (v: string) => void = () => {};
  let bValue: string | null = null;
  let releaseB: (v: string) => void = () => {};
  const bFlight = new Promise<string>(resolve => (releaseB = resolve));

  const el = document.createElement("div");
  const dispose = render(() => {
    const a = createMemo(() => (aVersion(), aFlight ?? "A"));
    const b = createMemo(() => (bVersion(), bValue ?? bFlight.then(v => v)));
    return (
      <Loading fallback={<p>wait</p>}>
        <Show when={b()}>
          <i>{b()}</i>
        </Show>
        <Show when={a()}>
          <b>{a()}</b>
        </Show>
      </Loading>
    );
  }, el);
  await wait(10);
  expect(el.innerHTML).toBe("<p>wait</p>");

  if (refetchA) {
    aFlight = new Promise<string>(resolve => (releaseA = resolve));
    setAVersion(1);
  }
  await wait(0);

  bValue = "B";
  releaseB("B");
  setBVersion(1);
  await wait(20);

  if (refetchA) {
    aFlight = null;
    releaseA("A");
    setAVersion(2);
  }
  await wait(50);
  const html = el.innerHTML;
  dispose();
  return html;
}

it("control: without a sibling refetch the content renders (#4541)", async () => {
  expect(await run(false)).toBe("<i>B</i><b>A</b>");
});

it("a sibling refetch in the same window still reveals once both settle (#4541)", async () => {
  expect(await run(true)).toBe("<i>B</i><b>A</b>");
});
