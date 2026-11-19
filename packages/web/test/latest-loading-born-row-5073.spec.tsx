/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
import { test, expect } from "vitest";
import { render } from "@solidjs/web";
import { createMemo, latest, For, Show } from "solid-js";

const wait = <T,>(value: T) => new Promise<T>(resolve => setTimeout(() => resolve(value), 5));

function Page(props: { wrap?: boolean }) {
  const first = createMemo(() => wait("a"), { loadingValue: undefined });
  const id = createMemo(() => first());
  const rows = createMemo(() => (id() ? wait([id()!]) : undefined));
  const loading = () => !latest(first) || (id() !== undefined && !latest(rows));
  const shows = () => (
    <>
      <Show when={loading()}>loading</Show>
      <Show when={!loading() && latest(rows)}>
        <div>
          <For each={latest(rows)}>{row => <i>{row}</i>}</For>
        </div>
      </Show>
    </>
  );
  return props.wrap ? <section>{shows()}</section> : shows();
}

test.each([false, true])(
  "#5073 the page shows its rows once both requests have resolved (wrapped: %s)",
  async wrap => {
    const root = document.createElement("div");
    const dispose = render(() => <Page wrap={wrap} />, root);
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(root.textContent).toBe("a");
    dispose();
  }
);
