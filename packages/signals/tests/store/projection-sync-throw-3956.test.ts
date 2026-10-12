import { expect, it } from "vitest";
import {
  createErrorBoundary,
  createLoadingBoundary,
  createProjection,
  createRenderEffect,
  createRoot,
  createSignal,
  flush
} from "../../src/index.js";

const settle = async (ms: number) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    await new Promise(r => setTimeout(r, 5));
    flush();
  }
};

it("projection: a synchronous throw on a version-bumped rerun reaches Errored (#3956)", async () => {
  const fetcher = (k: string) =>
    new Promise<{ items: string[] }>((res, rej) =>
      setTimeout(() => (k === "bad" ? rej(new Error("refused")) : res({ items: [`row-${k}`] })), 20)
    );
  const [key, setKey] = createSignal("good");
  const [version, setVersion] = createSignal(0, { ownedWrite: true });
  type E = {
    status: "pending" | "ok" | "error";
    p: Promise<{ items: string[] }>;
    v?: { items: string[] };
    e?: unknown;
  };
  const cache = new Map<string, E>();
  const entry = (k: string) => {
    let e = cache.get(k);
    if (!e) {
      const ne: E = { status: "pending", p: fetcher(k) };
      ne.p.then(
        v => {
          ne.status = "ok";
          ne.v = v;
          setVersion(x => x + 1);
        },
        err => {
          ne.status = "error";
          ne.e = err;
          setVersion(x => x + 1);
        }
      );
      cache.set(k, ne);
      e = ne;
    }
    return e;
  };
  let screen: unknown;
  createRoot(() => {
    const p = createProjection<{ value?: { items: string[] } }>(() => {
      version();
      const e = entry(key());
      if (e.status === "error") throw e.e;
      if (e.status === "ok") return { value: e.v! } as never;
      return e.p.then(v => ({ value: v })) as never;
    }, {});
    const view = createErrorBoundary(
      () =>
        createLoadingBoundary(
          () => (p.value?.items ?? []).join(","),
          () => "PENDING"
        ),
      () => "ERRORED"
    );
    createRenderEffect(
      () => {
        let v: any = view();
        while (typeof v === "function") v = v();
        return v;
      },
      v => {
        screen = v;
      }
    );
  });
  flush();
  await settle(60);
  expect(screen).toBe("row-good");
  setKey("bad");
  flush();
  await settle(200);
  expect(screen).toBe("ERRORED");
});
