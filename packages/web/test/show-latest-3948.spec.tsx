/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * #3948 as it ships: the narrowed accessor is read from a text binding, not
 * from a render effect registered beside the child. The binding runs in the
 * flush that selects the branch, before the condition memo commits.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { createSignal, flush, latest, Loading, resetErrorHalt, Show } from "solid-js";
import { render } from "../src/index.js";

afterEach(() => {
  resetErrorHalt();
  vi.restoreAllMocks();
});

async function settle() {
  await new Promise(r => setTimeout(r, 0));
  flush();
}

describe("non-keyed Show when={latest(async)} in the DOM (#3948)", () => {
  test("renders the arrived value on first mount without halting", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const container = document.createElement("div");
    document.body.appendChild(container);
    const [tick, setTick] = createSignal(0);
    const [identity] = createSignal(async () => "Bob");
    const dispose = render(
      () => (
        <Loading fallback={<p>Loading account</p>}>
          <Show when={latest(identity)}>{name => <h1>Signed in as {name()}</h1>}</Show>
          <span>{tick()}</span>
        </Loading>
      ),
      container
    );

    flush();
    await settle();
    await settle();

    expect(container.querySelector("h1")?.textContent).toBe("Signed in as Bob");
    expect(error.mock.calls.some(args => /REACTIVITY_HALTED/.test(String(args[0])))).toBe(false);

    setTick(1);
    flush();
    expect(container.querySelector("span")?.textContent).toBe("1");
    dispose();
    container.remove();
  });
});
