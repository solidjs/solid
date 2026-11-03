/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
/**
 * #4648 (after #4657): a non-keyed `<Show>` / `<Match>` over an async first
 * load mounts its function child in the flush the condition lands in. There
 * the narrowed condition has no committed value, only the staging the branch
 * mounted on, so a read of the accessor inside `isPending()` does what its
 * plain read does (D-23 exc. 1, F-9): it sees the landed value — it read the
 * empty committed slot (`undefined`) and `j().id` threw.
 */
import { render } from "@solidjs/web";
import { createMemo, flush, isPending, Loading, Match, Show, Switch } from "solid-js";
import { expect, it } from "vitest";

const tick = async (n = 3) => {
  for (let i = 0; i < n; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

for (const kind of ["Show", "Match"] as const)
  for (const order of ["probe first", "plain read first"] as const)
    it(`a narrowed <${kind}> accessor probed in its landing flush reads the landed value (${order})`, async () => {
      function Child(props: { j: () => { id: number } }) {
        return (
          <span>
            {(() => {
              let probed: unknown = "threw";
              let plain: unknown;
              if (order === "plain read first") plain = props.j().id;
              const p = isPending(() => (probed = props.j().id));
              if (order === "probe first") plain = props.j().id;
              return `${probed}/${plain}/${p}`;
            })()}
          </span>
        );
      }
      const el = document.createElement("div");
      const dispose = render(() => {
        const job = createMemo(() => Promise.resolve({ id: 2 }));
        return (
          <Loading fallback="loading">
            {kind === "Show" ? (
              <Show when={job()}>{j => <Child j={j} />}</Show>
            ) : (
              <Switch>
                <Match when={job()}>{j => <Child j={j} />}</Match>
              </Switch>
            )}
          </Loading>
        );
      }, el);
      const frames: string[] = [el.textContent!];
      await tick();
      frames.push(el.textContent!);
      dispose();
      expect(frames).toEqual(["loading", "2/2/false"]);
    });
