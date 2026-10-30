/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
import { expect, it } from "vitest";
import {
  createMemo,
  createProjection,
  createSignal,
  Errored,
  For,
  Loading,
  NotReadyError,
  onCleanup,
  untrack
} from "solid-js";
import { render } from "@solidjs/web";

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

it("#4342: switching the parent key does not spin the flush loop", async () => {
  const keys = new Set<() => { hash: string }>();
  let runs = 0;
  function useQuery<T>(keyFn: () => string, fetcher: () => Promise<T>) {
    const key = createMemo(() => ({ hash: keyFn() }));
    keys.add(key);
    onCleanup(() => keys.delete(key));
    const cache = new Map<string, any>();
    const data = createProjection<{ value?: T }>(() => {
      const k = key().hash;
      let e = cache.get(k);
      if (!e) {
        cache.set(k, (e = { p: fetcher().then(d => ((e.d = d), { value: d })) }));
        // The #4342 shape as reported: the cache probes its sibling keys
        // and swallows one that is not ready. Load-bearing for the repro
        // (rethrowing changes the outcome), and the reason this spec logs
        // CAUGHT_REACTIVE_READ in dev — a true positive about this code.
        for (const other of keys) {
          try {
            untrack(other);
          } catch (err) {
            if (!(err instanceof NotReadyError)) throw err;
          }
        }
      }
      return e.d !== undefined ? { value: e.d } : e.p;
    }, {});
    return () => data.value as T;
  }

  const el = document.createElement("div");
  const [id, setId] = createSignal("A");
  let release!: (v: { key: string }[]) => void;
  const later = new Promise<{ key: string }[]>(r => (release = r));
  function Item(props: { link: string; item: { key: string } }) {
    const opts = createMemo(() => {
      if (++runs > 1000) throw new Error("runaway: `opts` recomputed 1000 times");
      return { link: props.link, item: props.item.key };
    });
    useQuery(
      () => `${opts().link}:${opts().item}`,
      async () => 0
    );
    return <p>{props.item.key}</p>;
  }
  function List(props: { link: string }) {
    const list = useQuery(
      () => props.link,
      () => (props.link === "A" ? Promise.resolve([{ key: "a" }]) : later)
    );
    return (
      <Loading fallback="...">
        <Errored fallback={(e: any) => String(e())}>
          <For each={list()} keyed={(x: { key: string }) => x.key}>
            {x => <Item link={props.link} item={x()} />}
          </For>
        </Errored>
      </Loading>
    );
  }
  const dispose = render(() => {
    const link = createMemo(async () => {
      const v = id();
      await Promise.resolve();
      return v;
    });
    return (
      <Loading fallback="...">
        <List link={link()} />
      </Loading>
    );
  }, el);
  await wait(50);
  setId("B");
  setTimeout(() => release([{ key: "b" }]), 100);
  await wait(300);
  expect(runs).toBeLessThan(20);
  expect(el.textContent).toBe("b");
  dispose();
});
