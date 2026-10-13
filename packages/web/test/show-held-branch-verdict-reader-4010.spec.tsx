/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// #4010: a non-keyed <Show> branch that a held write mounts reads the value
// that mounted it on every pass — also from a binding that probes
// `isPending` on data the same write started loading (a verdict reader). It
// was served the committed screen, where the condition is still null, and
// threw into <Errored>; after #3977 an unchanged landing left the error up.
import { expect, test } from "vitest";
import { Errored, Loading, Show, createSignal, createStore, flush, isPending } from "solid-js";
import { render } from "../src/index.js";

for (const count of [0, 1])
  test(`a non-keyed Show reveals its branch after dependent data resolves (${count})`, async () => {
    const [selected, setSelected] = createSignal<{ name: string } | null>(null);
    const answer = Promise.withResolvers<{ count: number }>();
    const host = document.createElement("div");
    const errors: unknown[] = [];
    const dispose = render(() => {
      const [data] = createStore(() => (selected() ? answer.promise : { count: 0 }), {
        count: 0
      });
      return (
        <Loading fallback="Loading">
          <Errored
            fallback={error => {
              errors.push(error());
              return <p>{String(error())}</p>;
            }}
          >
            <Show when={selected()} fallback="Choose">
              {item => (
                <section
                  aria-label={item().name}
                  aria-busy={isPending(() => data.count) ? "true" : "false"}
                >
                  {data.count}
                </section>
              )}
            </Show>
          </Errored>
        </Loading>
      );
    }, host);
    try {
      flush();
      expect(host.textContent).toBe("Choose");
      setSelected({ name: "Example" });
      flush();
      expect(errors).toEqual([]);
      answer.resolve({ count });
      await answer.promise;
      flush();
      expect(errors).toEqual([]);
      const section = host.querySelector("section");
      expect(section?.getAttribute("aria-label")).toBe("Example");
      expect(section?.getAttribute("aria-busy")).toBe("false");
      expect(host.textContent).toBe(String(count));
    } finally {
      dispose();
    }
  });
