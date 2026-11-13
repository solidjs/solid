/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * #1742: a handler built by a call (`onChange={makeHandler()}`) is evaluated
 * where the element is created — inside the branch's tracked compute. A
 * signal read in the factory subscribed the branch, so writing that signal
 * re-ran it and remounted the handler's siblings. Handlers are not reactive:
 * the call runs untracked, and in dev the read reports STRICT_READ_UNTRACKED.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { render } from "@solidjs/web";
import { createSignal, flush } from "solid-js";

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => warn.mockRestore());
const strictReads = () =>
  warn.mock.calls.filter((c: unknown[]) => String(c[0]).includes("STRICT_READ_UNTRACKED")).length;

function setup(delegated: boolean) {
  const [show] = createSignal(true);
  const [prefix, setPrefix] = createSignal("a");
  const seen: string[] = [];
  const makeHandler = () => {
    const p = prefix();
    return () => seen.push(p);
  };
  const container = document.createElement("div");
  document.body.appendChild(container);
  const dispose = render(
    () => (
      <div>
        {show() && (
          <>
            {delegated ? <button onClick={makeHandler()} /> : <input onChange={makeHandler()} />}
            <span>sibling</span>
          </>
        )}
      </div>
    ),
    container
  );
  flush();
  return {
    seen,
    container,
    setPrefix: (v: string) => {
      setPrefix(v);
      flush();
    },
    cleanup: () => {
      dispose();
      container.remove();
    }
  };
}

describe("#1742 event handler factories run untracked", () => {
  for (const delegated of [false, true]) {
    const kind = delegated ? "delegated onClick" : "non-delegated onChange";

    test(`${kind}: a signal read in the factory does not remount siblings`, () => {
      const t = setup(delegated);
      const sibling = t.container.querySelector("span");
      const target = t.container.querySelector(delegated ? "button" : "input")!;
      t.setPrefix("b");
      expect(t.container.querySelector("span")).toBe(sibling);
      expect(t.container.querySelector(delegated ? "button" : "input")).toBe(target);
      if (delegated) target.click();
      else target.dispatchEvent(new Event("change"));
      expect(t.seen).toEqual(["a"]);
      t.cleanup();
    });

    test(`${kind}: a signal read in the factory reports STRICT_READ_UNTRACKED in dev`, () => {
      const t = setup(delegated);
      expect(strictReads()).toBe(1);
      t.cleanup();
    });
  }
});
