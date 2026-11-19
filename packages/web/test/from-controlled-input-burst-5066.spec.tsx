/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
import { afterEach, expect, test, vi } from "vitest";
import { createMemo, flush, from } from "solid-js";
import { render } from "@solidjs/web";

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

test("#5066 a synchronous subscription burst does not overwrite a controlled edit", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  let state = { text: "hello world", touched: false };
  const listeners = new Set<(value: typeof state) => void>();
  const form = {
    update(patch: Partial<typeof state>) {
      state = { ...state, ...patch };
      for (const listener of listeners) listener(state);
    },
    subscribe(listener: (value: typeof state) => void) {
      listeners.add(listener);
      listener(state);
      return () => listeners.delete(listener);
    }
  };
  const host = document.body.appendChild(document.createElement("div"));
  dispose = render(() => {
    const value = createMemo(() => from(form.subscribe));
    return (
      <input
        value={value().text}
        onInput={e => {
          form.update({ touched: true });
          form.update({ text: e.currentTarget.value });
        }}
      />
    );
  }, host);
  flush();
  const input = host.querySelector("input")!;
  const proto = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!;
  const writes: string[] = [];
  Object.defineProperty(input, "value", {
    configurable: true,
    get: () => proto.get!.call(input),
    set(value: string) {
      writes.push(value);
      proto.set!.call(input, value);
    }
  });

  proto.set!.call(input, "heXllo world");
  input.setSelectionRange(3, 3);
  input.dispatchEvent(
    new InputEvent("input", { bubbles: true, data: "X", inputType: "insertText" })
  );
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
    flush();
  }

  expect(writes).toEqual(["heXllo world"]);
  expect(input.value).toBe("heXllo world");
  expect(input.selectionStart).toBe(3);
  expect(
    warn.mock.calls.filter(args => String(args[0]).includes("UNCOMMITTED_INPUT_OVERWRITTEN"))
  ).toEqual([]);
});
