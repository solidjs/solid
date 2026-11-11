/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
/**
 * #4761: a non-keyed `<Show>` / `<Match>` branch that an optimistic write hides
 * during an action cannot come back when the action settles. Restoring the
 * branch runs its `ref` callback, which reads the narrowed accessor; that
 * throws the stale-value error and halts reactivity (`REACTIVITY_HALTED`).
 *
 * A plain reactive attribute (`title={value()}`) does not reproduce this —
 * only the `ref` read during restoration does.
 */
import { afterEach, expect, it, vi } from "vitest";
import { Match, Show, Switch, action, createOptimistic, flush, resetErrorHalt } from "solid-js";
import { render } from "@solidjs/web";

const tick = async (n = 4) => {
  for (let i = 0; i < n; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

afterEach(() => {
  resetErrorHalt();
  vi.restoreAllMocks();
});

for (const kind of ["Show", "Match"] as const) {
  it(`#4761: a narrowed <${kind}> accessor read from ref after optimistic hide restores`, async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    let release!: () => void;
    const gate = new Promise<void>(r => {
      release = r;
    });
    const el = document.createElement("div");
    document.body.appendChild(el);
    let hide!: () => Promise<void>;
    const dispose = render(() => {
      const [visible, setVisible] = createOptimistic(1);
      hide = action(function* () {
        setVisible(0);
        yield gate;
      });
      const branch = (value: () => number) => (
        <span
          ref={node => {
            node.title = String(value());
          }}
        >
          visible
        </span>
      );
      return kind === "Show" ? (
        <Show when={visible()}>{value => branch(value)}</Show>
      ) : (
        <Switch>
          <Match when={visible()}>{value => branch(value)}</Match>
        </Switch>
      );
    }, el);

    flush();
    expect(el.querySelector("span")?.title).toBe("1");
    expect(el.textContent).toBe("visible");

    const done = hide();
    await tick();
    expect(el.querySelector("span")).toBeNull();
    expect(el.textContent).toBe("");

    release();
    await done;
    await tick();

    expect(
      error.mock.calls.some(args =>
        /REACTIVITY_HALTED|stale value|Stale read/.test(String(args[0]))
      )
    ).toBe(false);
    expect(el.textContent).toBe("visible");
    expect(el.querySelector("span")?.title).toBe("1");
    dispose();
    el.remove();
  });
}
