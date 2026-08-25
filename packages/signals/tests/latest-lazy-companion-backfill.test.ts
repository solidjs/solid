/**
 * #3041: latest() first called during a held transition returned the committed
 * value. The latest-value companion is created lazily; syncCompanions only
 * pushes an in-flight write into companions that already exist, and the
 * companion's initial compute under a stale render effect sees _value.
 * getLatestValueComputed now backfills _pendingValue, mirroring getPendingSignal.
 */
import {
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  isPending,
  latest
} from "../src/index.js";

it("latest() first read during a held transition sees in-flight value (#3041)", async () => {
  let resolve!: (v: string) => void;
  const fetch = (n: string) =>
    new Promise<string>(r => {
      resolve = r;
    });
  let seen: string[] = [];
  createRoot(() => {
    const [query, setQuery] = createSignal("pikachu");
    const pokemon = createMemo(() => fetch(query()));
    createRenderEffect(
      () => {
        const p = isPending(() => pokemon());
        // latest() is NOT called until pending — companion created lazily inside transition
        return p ? latest(() => query()) : "idle:" + (pokemon() as any);
      },
      v => {
        seen.push(String(v));
      }
    );
    (globalThis as any).setQuery = setQuery;
  });
  flush();
  resolve("pikachu");
  await new Promise(r => setTimeout(r, 0));
  flush();
  seen = [];
  (globalThis as any).setQuery("charizard");
  flush();
  expect(seen).toEqual(["charizard"]);
});

it("control: companion pre-warmed before transition", async () => {
  let resolve!: (v: string) => void;
  const fetch = (n: string) =>
    new Promise<string>(r => {
      resolve = r;
    });
  let seen: string[] = [];
  let setQuery!: (v: string) => void;
  createRoot(() => {
    const [query, s] = createSignal("pikachu");
    setQuery = s;
    const pokemon = createMemo(() => fetch(query()));
    latest(() => query()); // warm
    createRenderEffect(
      () => (isPending(() => pokemon()) ? latest(() => query()) : "idle"),
      v => {
        seen.push(String(v));
      }
    );
  });
  flush();
  resolve("pikachu");
  await new Promise(r => setTimeout(r, 0));
  flush();
  seen = [];
  setQuery("charizard");
  flush();
  expect(seen).toEqual(["charizard"]);
});
