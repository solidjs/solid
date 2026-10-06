/**
 * @jsxImportSource @solidjs/web
 *
 * #3764: a live source created in the shell and read only inside a streamed
 * <Loading> boundary.
 */
import { createMemo, createOptimisticStore, Errored, For, Loading, Show } from "solid-js";
import { isServer } from "@solidjs/web";

const LIVE = Symbol.for("solid.LiveSource");
const ROWS = [{ id: 1 }, { id: 2 }];

function source(liveMs: number, liveRows: { id: number }[] = ROWS, serverMs = 50): any {
  if (isServer) return new Promise(r => setTimeout(() => r(ROWS), serverMs));
  return {
    [LIVE]: true,
    [Symbol.asyncIterator]: () => {
      let sent = false;
      return {
        next: () =>
          sent
            ? new Promise(() => {})
            : new Promise(res =>
                setTimeout(() => ((sent = true), res({ done: false, value: liveRows })), liveMs)
              ),
        return: () => Promise.resolve({ done: true })
      };
    }
  };
}

export function A(props: { liveMs: number; liveRows?: { id: number }[] }) {
  const rows = createMemo(() => source(props.liveMs, props.liveRows));
  return (
    <Loading fallback={null}>
      <Show when={rows().length > 0}>
        <ul class="a">
          <li>rows: {rows().length}</li>
        </ul>
      </Show>
    </Loading>
  );
}

export function B(props: { liveMs: number }) {
  const [rows] = createOptimisticStore(() => source(props.liveMs), [] as { id: number }[], {
    key: "id"
  });
  createMemo(() => rows.map(r => r.id).join(","));
  return (
    <Errored fallback={e => <p class="err">{String(e())}</p>}>
      <Loading fallback={null}>
        <ul class="b">
          <For each={[...rows]} keyed={r => r.id}>
            {r => <li>{r().id}</li>}
          </For>
        </ul>
      </Loading>
    </Errored>
  );
}

export function C(props: { liveMs: number; liveRows?: { id: number }[] }) {
  const rows = createMemo(() => source(props.liveMs, props.liveRows, 0));
  const shell = createMemo(async () => {
    if (isServer) await new Promise(r => setTimeout(r, 20));
    return "shell";
  });
  const slow = createMemo(async () => {
    if (isServer) await new Promise(r => setTimeout(r, 50));
    return "slow";
  });
  return (
    <>
      <h1>{shell()}</h1>
      <Loading fallback={null}>
        <ul class="c">
          <li>{slow()}</li>
          <li>rows: {rows().length}</li>
        </ul>
      </Loading>
    </>
  );
}
