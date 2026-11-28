/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
import { test, expect } from "vitest";
import { render } from "@solidjs/web";
import { createMemo, latest, For, Show } from "solid-js";

const wait = <T,>(value: T) => new Promise<T>(resolve => setTimeout(() => resolve(value), 5));

function Page() {
  const lists = createMemo(() => wait(["l1"]), { loadingValue: undefined });
  const active = createMemo(() => latest(lists)?.[0] ?? null);
  const items = createMemo(() => (active() ? wait({ key: active(), rows: ["Milk"] }) : undefined), {
    loadingValue: undefined
  });
  const rows = () => {
    const r = latest(items);
    return r && r.key === active() ? r.rows : undefined;
  };
  const loading = () => !latest(lists) || (active() !== null && !rows());
  return (
    <>
      <Show when={loading()}>loading</Show>
      <Show when={!loading()}>
        <div>
          <For each={rows() ?? []}>{row => <i>{row}</i>}</For>
        </div>
      </Show>
    </>
  );
}

test("#5211 the rows render once both chained memos resolve", async () => {
  const root = document.createElement("div");
  const dispose = render(() => <Page />, root);
  await new Promise(resolve => setTimeout(resolve, 100));
  expect(root.textContent).toBe("Milk");
  dispose();
});
