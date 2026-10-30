/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * #4354 as it ships: `setOpen(false)` is held by a `<Loading>` sibling's
 * re-ask, so the `<Show>` branch stays on screen while its selection has
 * already re-run in the held world. An unrelated write re-runs the branch's
 * text binding, which reads the narrowed accessor beside `fmt()`; it must
 * read the screen's value, not halt. The branch closes when the hold lands.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { createMemo, createSignal, flush, Loading, resetErrorHalt, Show } from "solid-js";
import { render } from "../src/index.js";

afterEach(() => {
  resetErrorHalt();
  vi.restoreAllMocks();
});

async function settle() {
  for (let i = 0; i < 3; i++) {
    await Promise.resolve();
    flush();
  }
}

describe("<Show> branch re-run during the hold that closes it (#4354)", () => {
  for (const keyed of [false, true])
    test(keyed ? "keyed" : "non-keyed", async () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const container = document.createElement("div");
      document.body.appendChild(container);
      const [open, setOpen] = createSignal(true);
      const [fmt, setFmt] = createSignal("ru");
      const resolvers: (() => void)[] = [];
      const data = createMemo(() => {
        const o = open();
        return new Promise<string>(r => resolvers.push(() => r(`data-${o}`)));
      });
      const dispose = render(
        () => (
          <>
            {keyed ? (
              <Show when={open() && "sel"} keyed fallback={<i>closed</i>}>
                {v => <p>{`${fmt()}:${v}`}</p>}
              </Show>
            ) : (
              <Show when={open() && "sel"} fallback={<i>closed</i>}>
                {v => <p>{`${fmt()}:${v()}`}</p>}
              </Show>
            )}
            <Loading fallback={<b>wait</b>}>
              <span>{data()}</span>
            </Loading>
          </>
        ),
        container
      );
      const view = () => container.textContent;

      flush();
      resolvers.shift()!();
      await settle();
      expect(view()).toBe("ru:seldata-true");

      setOpen(false); // held by data's re-ask: the branch stays on screen
      flush();
      expect(view()).toBe("ru:seldata-true");

      setFmt("en"); // unrelated write re-runs the on-screen binding mid-hold
      flush();
      expect(view()).toBe("en:seldata-true");

      resolvers.shift()!();
      await settle();
      expect(view()).toBe("closeddata-false");
      expect(error.mock.calls.map(c => String(c[0]).split("\n")[0])).toEqual([]);

      setFmt("fr");
      flush();
      expect(view()).toBe("closeddata-false");
      dispose();
      container.remove();
    });
});
