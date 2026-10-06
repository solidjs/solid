/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * #3835: a component mounted by an optimistic write reveals with the lane's
 * screen values. Its memo's render effects used to be born held by the
 * transaction, so the element showed before its style was ever applied.
 */
import { describe, expect, test } from "vitest";
import { action, createMemo, createOptimistic, createSignal, flush, Show } from "solid-js";
import { render } from "@solidjs/web";

const tick = () => new Promise<void>(r => setTimeout(r, 0));

function setup(opts: { memo: boolean; dynamicText: boolean }) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let run!: () => Promise<void>;
  let finish!: () => void;

  function Content(props: { enabled: () => boolean }) {
    const view = () => (
      <div style={{ color: props.enabled() ? "blue" : "red" }}>
        Hello{opts.dynamicText ? (props.enabled() ? " world" : "") : ""}
      </div>
    );
    return opts.memo ? createMemo(view) : view();
  }

  function App() {
    const [enabled, setEnabled] = createSignal(false);
    const [visible, setVisible] = createOptimistic(enabled);
    const act = action(function* () {
      setEnabled(true);
      setVisible(true);
      yield new Promise<void>(r => (finish = r));
    });
    run = () => act();
    return (
      <>
        <Show when={visible()}>
          <Content enabled={enabled} />
        </Show>
      </>
    );
  }

  const dispose = render(() => <App />, container);
  return {
    container,
    run: () => run(),
    finish: () => finish(),
    dispose: () => {
      dispose();
      container.remove();
    }
  };
}

describe("#3835 optimistic mount applies its bindings at the reveal", () => {
  for (const memo of [true, false])
    for (const dynamicText of [true, false])
      test(`memo=${memo} dynamicText=${dynamicText}`, async () => {
        const s = setup({ memo, dynamicText });
        flush();
        expect(s.container.innerHTML).toBe("");
        const p = s.run();
        flush();
        await tick();
        flush();
        const during = s.container.innerHTML;
        s.finish();
        await p;
        await tick();
        flush();
        const after = s.container.innerHTML;
        s.dispose();
        expect({ during, after }).toEqual({
          during: '<div style="color: red;">Hello</div>',
          after: dynamicText
            ? '<div style="color: blue;">Hello world</div>'
            : '<div style="color: blue;">Hello</div>'
        });
      });
});
