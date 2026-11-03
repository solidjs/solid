/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
/**
 * #4648: a non-keyed `<Show>` (or `<Match>`) over an async condition mounts
 * its function child in the flush the condition lands in. A binding in the
 * child reads the narrowed accessor inside an `isPending()` thunk: the branch
 * is on screen, so the accessor is not stale there, and the reads after it
 * link so the verdict flips while `q`'s update is held (D-23, F-9).
 */
import { render } from "@solidjs/web";
import { createMemo, createSignal, flush, isPending, Loading, Match, Show, Switch } from "solid-js";
import { expect, it } from "vitest";

const tick = async (n = 3) => {
  for (let i = 0; i < n; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

it("a narrowed <Show> accessor read inside isPending() does not throw the stale-value error", async () => {
  const [q, setQ] = createSignal(0);
  const resolvers: ((v: number[]) => void)[] = [];
  function Child(props: { job: { id: number } }) {
    const rows = createMemo(() => {
      const x = q();
      return x === 0 ? [0] : new Promise<number[]>(r => resolvers.push(r));
    });
    return (
      <>
        <Show
          when={isPending(() => {
            void props.job;
            return q();
          })}
        >
          <b>via accessor</b>
        </Show>
        <Show when={isPending(() => q())}>
          <b>direct</b>
        </Show>
        <span>
          {(() => {
            let e = "none";
            isPending(() => {
              try {
                void props.job;
              } catch {
                e = "GUARD";
              }
              return q();
            });
            return e;
          })()}
        </span>
        <i>{rows()[0]}</i>
      </>
    );
  }
  const el = document.createElement("div");
  const dispose = render(() => {
    const job = createMemo(() => Promise.resolve({ id: 2 }));
    return (
      <Loading fallback="loading">
        <Show when={job()}>{j => <Child job={j()} />}</Show>
      </Loading>
    );
  }, el);
  const frames: string[] = [el.textContent!];
  await tick();
  frames.push(el.textContent!);
  setQ(1);
  flush();
  await tick(1);
  frames.push(el.textContent!);
  resolvers.forEach(r => r([1]));
  await tick();
  frames.push(el.textContent!);
  dispose();
  expect(frames).toEqual(["loading", "none0", "via accessordirectnone0", "none1"]);
});

for (const kind of ["Show", "Match"] as const)
  it(`a narrowed <${kind}> accessor read in a plain isPending() thunk links what follows it`, async () => {
    const [q, setQ] = createSignal(0);
    const resolvers: ((v: number[]) => void)[] = [];
    function Child(props: { j: () => { id: number } }) {
      const rows = createMemo(() => {
        const x = q();
        return x === 0 ? [0] : new Promise<number[]>(r => resolvers.push(r));
      });
      return (
        <>
          <Show
            when={isPending(() => {
              props.j();
              return q();
            })}
          >
            <b>via accessor</b>
          </Show>
          <i>{rows()[0]}</i>
        </>
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
    setQ(1);
    flush();
    await tick(1);
    frames.push(el.textContent!);
    resolvers.forEach(r => r([1]));
    await tick();
    frames.push(el.textContent!);
    dispose();
    expect(frames).toEqual(["loading", "0", "via accessor0", "1"]);
  });
