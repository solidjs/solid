// #5160: Non-keyed <Show> / <Match> closing on a `latest()` update while a
// sibling async read holds the transaction must not re-evaluate a closing
// branch's child memo before disposal.

import { afterEach, describe, expect, it } from "vitest";
import {
  createLoadingBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  latest,
  Match,
  Show,
  Switch
} from "../src/index.js";

afterEach(() => flush());

const tick = async (n = 12) => {
  for (let i = 0; i < n; i++) await Promise.resolve();
  flush();
};

const unwrap = (v: unknown) => (typeof v === "function" ? (v as () => unknown)() : v);

describe("#5160 non-keyed <Show> / <Match> closing while another async read holds", () => {
  for (const sync of [true, false]) {
    it(`does not halt with a stale read when the update that closes <Show> waits on an async read (sync: ${sync})`, async () => {
      let setId!: (v: number) => void;
      let resolveSlow!: (v: string) => void;
      const seenChild: string[] = [];
      const seenShow: unknown[] = [];

      const dispose = createRoot(d => {
        const [id, _setId] = createSignal(1);
        setId = _setId;

        const data = createMemo(() =>
          id() === 1
            ? { id: 1, status: "modelFailed", reason: "boom" as string | undefined }
            : { id: 2, status: "running", reason: undefined as string | undefined }
        );
        const slow = createMemo(() =>
          id() === 1 ? Promise.resolve("ok-1") : new Promise<string>(r => (resolveSlow = r))
        );

        const show = Show({
          get when() {
            return latest(data).reason;
          },
          fallback: "fallback",
          children: value => {
            const read = createMemo(() => `${latest(data).status}/${value()}`, { sync });
            createRenderEffect(read, v => void seenChild.push(v));
            return (() => read()) as any;
          }
        }) as unknown as () => unknown;

        createRenderEffect(
          () => unwrap(show()),
          v => void seenShow.push(v)
        );
        createRenderEffect(slow, () => {});
        return d;
      });

      try {
        flush();
        await tick();
        expect(seenChild).toEqual(["modelFailed/boom"]);
        expect(seenShow).toEqual(["modelFailed/boom"]);

        setId(2);
        flush();
        await tick();
        expect(seenShow).toEqual(["modelFailed/boom", "fallback"]);
        expect(seenChild).toEqual(["modelFailed/boom"]);

        resolveSlow("ok-2");
        flush();
        await tick();
        expect(seenShow).toEqual(["modelFailed/boom", "fallback"]);
      } finally {
        dispose();
      }
    });
  }

  it("does not halt when the slow async source sits at a lower graph height than `when`", async () => {
    let setId!: (v: number) => void;
    let resolveSlow!: (v: string) => void;
    const seenChild: string[] = [];
    const seenShow: unknown[] = [];

    const dispose = createRoot(d => {
      const [id, _setId] = createSignal(1);
      setId = _setId;

      const data = createMemo(() =>
        id() === 1
          ? { id: 1, status: "modelFailed", reason: "boom" as string | undefined }
          : { id: 2, status: "running", reason: undefined as string | undefined }
      );
      const m1 = createMemo(() => latest(data).reason);
      const m2 = createMemo(() => m1());

      const slow = createMemo(() =>
        id() === 1 ? "ok-1" : new Promise<string>(r => (resolveSlow = r))
      );
      createRenderEffect(slow, () => {});

      const show = Show({
        get when() {
          return m2();
        },
        fallback: "fallback",
        children: value => {
          const read = createMemo(() => `${latest(data).status}/${value()}`, { sync: true });
          createRenderEffect(read, v => void seenChild.push(v));
          return (() => read()) as any;
        }
      }) as unknown as () => unknown;

      createRenderEffect(
        () => unwrap(show()),
        v => void seenShow.push(v)
      );
      return d;
    });

    try {
      flush();
      await tick();

      setId(2);
      flush();
      await tick();
      expect(seenShow).toEqual(["modelFailed/boom", "fallback"]);
      expect(seenChild).toEqual(["modelFailed/boom"]);

      resolveSlow("ok-2");
      flush();
      await tick();
    } finally {
      dispose();
    }
  });

  it("does not halt in non-keyed <Switch>/<Match> or when the child only reads the narrowed accessor", async () => {
    let setId!: (v: number) => void;
    let resolveSlow!: (v: string) => void;
    const seenSwitch: unknown[] = [];
    const seenPlain: string[] = [];

    const dispose = createRoot(d => {
      const [id, _setId] = createSignal(1);
      setId = _setId;

      const data = createMemo(() =>
        id() === 1
          ? { id: 1, status: "modelFailed", reason: "boom" as string | undefined }
          : { id: 2, status: "running", reason: undefined as string | undefined }
      );
      const slow = createMemo(() =>
        id() === 1 ? "ok-1" : new Promise<string>(r => (resolveSlow = r))
      );

      const sw = Switch({
        fallback: "fallback",
        get children() {
          return Match({
            get when() {
              return latest(data).reason;
            },
            children: value => {
              const read = createMemo(() => `${latest(data).status}/${value()}`);
              createRenderEffect(read, () => {});
              return (() => read()) as any;
            }
          });
        }
      }) as unknown as () => unknown;

      const plainShow = Show({
        get when() {
          return latest(data).reason;
        },
        fallback: "plain-fallback",
        children: value => {
          const upper = createMemo(() => value().toUpperCase());
          createRenderEffect(upper, v => void seenPlain.push(v));
          return (() => upper()) as any;
        }
      }) as unknown as () => unknown;

      createRenderEffect(
        () => unwrap(sw()),
        v => void seenSwitch.push(v)
      );
      createRenderEffect(
        () => unwrap(plainShow()),
        () => {}
      );
      createRenderEffect(slow, () => {});
      return d;
    });

    try {
      flush();
      await tick();
      expect(seenSwitch).toEqual(["modelFailed/boom"]);
      expect(seenPlain).toEqual(["BOOM"]);

      setId(2);
      flush();
      await tick();
      expect(seenSwitch).toEqual(["modelFailed/boom", "fallback"]);
      expect(seenPlain).toEqual(["BOOM"]);

      resolveSlow("ok-2");
      flush();
      await tick();
    } finally {
      dispose();
    }
  });

  it("keeps the closing branch alive if another async hold suspends during the same round", async () => {
    let setId!: (v: number) => void;
    let resolveSlow1!: (v: string) => void;
    let resolveSlow2!: (v: string) => void;
    const seenShow: unknown[] = [];

    const dispose = createRoot(d => {
      const [id, _setId] = createSignal(1);
      setId = _setId;

      const data = createMemo(() =>
        id() === 1
          ? { id: 1, status: "modelFailed", reason: "boom" as string | undefined }
          : { id: 2, status: "running", reason: undefined as string | undefined }
      );
      const slow1 = createMemo(() =>
        id() === 1 ? Promise.resolve("s1-1") : new Promise<string>(r => (resolveSlow1 = r))
      );
      const slow2 = createMemo(() =>
        latest(data).status === "running" ? new Promise<string>(r => (resolveSlow2 = r)) : "fb-init"
      );

      const bound = createLoadingBoundary(
        () => {
          const show = Show({
            get when() {
              return latest(data).reason;
            },
            fallback: (() => `fb:${slow2()}`) as any,
            children: value => {
              const read = createMemo(() => `${latest(data).status}/${value()}`);
              createRenderEffect(read, () => {});
              return (() => read()) as any;
            }
          }) as unknown as () => unknown;
          const gate = createMemo(() => (latest(data).status === "running" ? slow2() : "ok"));
          createRenderEffect(
            () => `${unwrap(show())}|${gate()}`,
            v => void seenShow.push(v)
          );
          createRenderEffect(slow1, () => {});
          return "";
        },
        () => "loading"
      ) as unknown as () => unknown;
      createRenderEffect(bound, () => {});
      return d;
    });

    try {
      flush();
      await tick();
      expect(seenShow).toEqual(["modelFailed/boom|ok"]);

      setId(2);
      flush();
      await tick();
      expect(seenShow).toEqual(["modelFailed/boom|ok"]);

      resolveSlow2("fb-done");
      flush();
      await tick();
      expect(seenShow).toEqual(["modelFailed/boom|ok", "fb:fb-done|fb-done"]);

      resolveSlow1("s1-2");
      flush();
      await tick();
    } finally {
      dispose();
    }
  });
});
