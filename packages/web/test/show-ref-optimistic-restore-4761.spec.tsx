/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
import { describe, expect, test } from "vitest";
import {
  Match,
  Show,
  Switch,
  action,
  createMemo,
  createOptimistic,
  createRoot,
  createSignal,
  flush
} from "solid-js";
import { render } from "../src/index.js";

const tick = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

describe("#4761: a non-keyed branch hidden by an optimistic write comes back", () => {
  for (const kind of ["Show", "Match"] as const)
    test(kind, async () => {
      let release!: () => void;
      const gate = new Promise<void>(r => (release = r));
      const c = document.body.appendChild(document.createElement("div"));
      let hide!: () => any;
      const errors: unknown[] = [];
      const orig = console.error;
      console.error = (...a) => errors.push(a);
      try {
        const dispose = render(() => {
          const [visible, setVisible] = createOptimistic(1);
          hide = action(function* () {
            setVisible(0);
            yield gate;
          });
          const span = (value: () => number) => (
            <span ref={el => (el.title = String(value()))}>visible</span>
          );
          return kind === "Show" ? (
            <Show when={visible()}>{span}</Show>
          ) : (
            <Switch>
              <Match when={visible()}>{span}</Match>
            </Switch>
          );
        }, c);
        flush();
        expect(c.innerHTML).toBe('<span title="1">visible</span>');
        hide();
        await tick();
        expect(c.innerHTML).toBe("");
        release();
        await tick();
        expect(errors).toEqual([]);
        expect(c.innerHTML).toBe('<span title="1">visible</span>');
        dispose();
      } finally {
        console.error = orig;
        c.remove();
      }
    });
});

describe("#4761: a ref callback runs like a render effect's callback", () => {
  test("creating a primitive in it is an error (dev)", () => {
    expect(() =>
      createRoot(() => {
        <div ref={() => createMemo(() => 1)} />;
      })
    ).toThrow(/PRIMITIVE_IN_EFFECT_CALLBACK/);
  });

  test("writing a signal in it is not an owned-scope write", () => {
    const [el, setEl] = createSignal<HTMLDivElement>();
    createRoot(() => {
      <div ref={e => setEl(e)} />;
    });
    flush();
    expect(el()).toBeInstanceOf(HTMLDivElement);
  });
});
