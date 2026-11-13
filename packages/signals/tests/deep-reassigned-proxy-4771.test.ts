/**
 * #4771: an optimistic store row tracked with `deep()`, patched with a
 * shallow spread of a memo's nested object (`{ ...spec(), speed }`), so the
 * nested `center` array written back is the store's own proxy. On rc.21 the
 * second update never returned: `deep()` looped at 100% CPU. Fixed on `next`
 * by the store guess carrier (S-59, #4729); pinned here.
 */
import { expect, it } from "vitest";
import {
  action,
  createEffect,
  createMemo,
  createOptimisticStore,
  createRoot,
  deep,
  flush,
  refresh
} from "../src/index.js";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

it("#4771: deep() over a row whose nested proxy was written back settles", async () => {
  let server: any[] = [{ id: 1, spec: { center: [10.5, 52.2], speed: 5 } }];
  let spec!: () => any;
  let update!: (patch: any) => Promise<void>;
  const speeds: number[] = [];
  createRoot(() => {
    const [store, setStore] = createOptimisticStore(async () => {
      await sleep(5);
      return JSON.parse(JSON.stringify(server));
    }, [] as any[]);
    update = action(async function* (patch: any) {
      setStore((list: any[]) => {
        Object.assign(list[0], patch);
      });
      yield sleep(5).then(() => {
        server = [{ ...server[0], ...JSON.parse(JSON.stringify(patch)) }];
      });
      refresh(store);
    }) as any;
    spec = createMemo(() => store[0]?.spec);
    createEffect(
      () => (store[0] ? deep(store[0]) : null),
      (v: any) => void (v && speeds.push(v.spec.speed))
    );
  });
  await sleep(30);
  flush();
  for (let i = 1; i <= 3; i++) {
    await update({ spec: { ...spec(), speed: 5 + i } });
    await sleep(30);
    flush();
  }
  expect(speeds.at(-1)).toBe(8);
}, 5000);
