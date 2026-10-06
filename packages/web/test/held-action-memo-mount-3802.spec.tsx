/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
import { afterEach, expect, test, vi } from "vitest";
import { Show, action, createMemo, createSignal, flush } from "solid-js";
import { render } from "../src/index.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(r => (resolve = r));
  return { promise, resolve };
}

async function settle() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
  flush();
}

afterEach(() => vi.restoreAllMocks());

test("updating an attribute of a subtree mounted under a held action does not crash (#3802)", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const div = document.createElement("div");
  const [value, setValue] = createSignal(false);
  const [mounted, setMounted] = createSignal(false);
  const [title, setTitle] = createSignal("");
  const gate = deferred();

  const save = action(function* () {
    setValue(true);
    yield gate.promise;
  });

  const dispose = render(
    () => (
      <main>
        <Show when={mounted()}>
          {_ => {
            createMemo(() => value());
            return <div class={String(value())} title={title()} />;
          }}
        </Show>
      </main>
    ),
    div
  );
  flush();

  const pending = save();
  await settle();
  setMounted(true);
  await settle();
  setTitle("Updated");
  await settle();

  expect(error).not.toHaveBeenCalled();

  gate.resolve();
  await pending;
  await settle();

  expect(error).not.toHaveBeenCalled();
  const el = div.querySelector("div")!;
  expect(el.className).toBe("true");
  expect(el.title).toBe("Updated");
  dispose();
});
