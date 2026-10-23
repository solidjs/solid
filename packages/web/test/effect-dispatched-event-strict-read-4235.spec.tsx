/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * #4235: a DOM call that dispatches events synchronously (`el.focus()`,
 * `el.click()`, `dialog.showModal()`) made from an effect's apply half runs
 * the element's handlers inside that callback. A handler is a one-shot
 * snapshot whoever dispatched the event, so its prop reads must not log
 * STRICT_READ_UNTRACKED — the same as a user-initiated event.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { render } from "@solidjs/web";
import { createEffect, createMemo, createRoot, createSignal, createStore, flush } from "solid-js";

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => warn.mockRestore());
const strictReads = () =>
  warn.mock.calls.filter((c: unknown[]) => String(c[0]).includes("STRICT_READ_UNTRACKED")).length;

function setup(fire: (el: HTMLInputElement) => void) {
  const seen: string[] = [];
  const [open, setOpen] = createSignal(false);
  const [label] = createSignal("Name");
  let box!: HTMLDivElement;
  function Field(props: { label: string }) {
    return (
      <input
        onFocus={() => seen.push(`focus:${props.label}`)}
        onClick={() => seen.push(`click:${props.label}`)}
      />
    );
  }
  const container = document.createElement("div");
  document.body.appendChild(container);
  const dispose = render(() => {
    createEffect(open, isOpen => {
      if (isOpen) fire(box.querySelector("input")!);
    });
    return (
      <div ref={box}>
        <Field label={label()} />
      </div>
    );
  }, container);
  flush();
  return {
    seen,
    open: () => {
      setOpen(true);
      flush();
    },
    cleanup: () => {
      dispose();
      container.remove();
    }
  };
}

describe("#4235 events dispatched from an effect callback", () => {
  test("non-delegated onFocus fired by el.focus() reads props without STRICT_READ_UNTRACKED", () => {
    const t = setup(el => el.focus());
    t.open();
    expect(t.seen).toEqual(["focus:Name"]);
    expect(strictReads()).toBe(0);
    t.cleanup();
  });

  test("delegated onClick fired by el.click() reads props without STRICT_READ_UNTRACKED", () => {
    const t = setup(el => el.click());
    t.open();
    expect(t.seen).toEqual(["click:Name"]);
    expect(strictReads()).toBe(0);
    t.cleanup();
  });

  test("a store read in a handler fired from an effect does not warn", () => {
    const [state] = createStore({ label: "Name" });
    const seen: string[] = [];
    const [go, setGo] = createSignal(false);
    let input!: HTMLInputElement;
    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = render(() => {
      createEffect(go, v => {
        if (v) input.focus();
      });
      return <input ref={input} onFocus={() => seen.push(state.label)} />;
    }, container);
    flush();
    setGo(true);
    flush();
    expect(seen).toEqual(["Name"]);
    expect(strictReads()).toBe(0);
    dispose();
    container.remove();
  });

  test("the effect body's own untracked read still warns", () => {
    const [n] = createSignal(1);
    const [go, setGo] = createSignal(false);
    const container = document.createElement("div");
    const dispose = render(() => {
      createEffect(go, v => {
        if (v) n();
      });
      return <div />;
    }, container);
    flush();
    setGo(true);
    flush();
    expect(strictReads()).toBe(1);
    dispose();
  });

  test("an effect flushed synchronously from inside a user event still warns", () => {
    const [n] = createSignal(1);
    const [go, setGo] = createSignal(false);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = render(() => {
      createEffect(go, v => {
        if (v) n();
      });
      return (
        <button
          onClick={() => {
            setGo(true);
            flush();
          }}
        />
      );
    }, container);
    flush();
    (container.firstElementChild as HTMLButtonElement).click();
    expect(strictReads()).toBe(1);
    dispose();
    container.remove();
  });

  test("a root created in a handler fired from an effect is not PRIMITIVE_IN_EFFECT_CALLBACK", () => {
    const [go, setGo] = createSignal(false);
    let input!: HTMLInputElement;
    let made = 0;
    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = render(() => {
      createEffect(go, v => {
        if (v) input.focus();
      });
      return (
        <input
          ref={input}
          onFocus={() =>
            createRoot(d => {
              createMemo(() => made++);
              d();
            })
          }
        />
      );
    }, container);
    flush();
    setGo(true);
    expect(() => flush()).not.toThrow();
    expect(made).toBe(1);
    dispose();
    container.remove();
  });

  test("a root created in the effect callback itself still throws PRIMITIVE_IN_EFFECT_CALLBACK", () => {
    const [go, setGo] = createSignal(false);
    let error: unknown;
    const container = document.createElement("div");
    const dispose = render(() => {
      createEffect(go, v => {
        if (v)
          try {
            createRoot(d => d());
          } catch (e) {
            error = e;
          }
      });
      return <div />;
    }, container);
    flush();
    setGo(true);
    flush();
    expect(String(error)).toContain("PRIMITIVE_IN_EFFECT_CALLBACK");
    dispose();
  });
});
