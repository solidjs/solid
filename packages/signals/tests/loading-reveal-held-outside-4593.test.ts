/**
 * #4593 / #4591 (F-7, F-1, F-2, F-5, F-12, D-41): a `<Loading>` does not
 * reveal content derived from a write still held outside it.
 *
 * #4593: a first-load boundary's content (`b`, by `s`) lands for `s = 1`
 * while the `s` write is held on `a:1`, read outside. `b=21` belongs to that
 * hold and reveals with its commit, never beside `s=0`.
 * #4591: under an armed `on` boundary, the content's rejection for `s1 = 2`
 * is an answer for that question: it shows when a value would — at the
 * hold's commit — and does not drop the fallback or commit the held write.
 */
import { describe, expect, test } from "vitest";
import {
  createErrorBoundary,
  createLoadingBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  untrack
} from "../src/index.js";

const tick = async () => {
  for (let i = 0; i < 2; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

type Flight = { resolve: (v: number) => void; reject: (e: Error) => void };

describe("a Loading does not reveal content derived from a write held outside it", () => {
  test("#4593: first load, the content's answer for the held write waits for its commit", async () => {
    const flights = new Map<string, Flight>();
    const ask = (key: string) =>
      new Promise<number>((resolve, reject) => flights.set(key, { resolve, reject }));
    const [s, setS] = createSignal(0);
    const screen = { a: "", s: "", b: "" };
    const frames: string[] = [];
    const frame = () => frames.push(`a=${screen.a}s=${screen.s}${screen.b}`);
    const dispose = createRoot(d => {
      const a = createMemo(() => ask("a:" + s()));
      const b = createMemo(() => ask("b:" + s()));
      createRenderEffect(a, v => void (screen.a = String(v)));
      createRenderEffect(s, v => void (screen.s = String(v)));
      const out = untrack(() =>
        createLoadingBoundary(
          () => "b=" + b(),
          () => "loading b"
        )
      );
      createRenderEffect(out, v => void (screen.b = String(v)));
      return d;
    });
    flush();
    await tick();
    flights.get("a:0")!.resolve(10);
    await tick();
    frame();
    setS(1);
    flush();
    await tick();
    frame();
    flights.get("b:1")!.resolve(21);
    await tick();
    frame();
    flights.get("a:1")!.resolve(11);
    await tick();
    frame();
    dispose();
    expect(frames).toEqual([
      "a=10s=0loading b",
      "a=10s=0loading b",
      "a=10s=0loading b",
      "a=11s=1b=21"
    ]);
  });

  test("#4593: the hold commits first — the content stays loading until its own answer", async () => {
    const flights = new Map<string, Flight>();
    const ask = (key: string) =>
      new Promise<number>((resolve, reject) => flights.set(key, { resolve, reject }));
    const [s, setS] = createSignal(0);
    const screen = { a: "", s: "", b: "" };
    const frames: string[] = [];
    const frame = () => frames.push(`a=${screen.a}s=${screen.s}${screen.b}`);
    const dispose = createRoot(d => {
      const a = createMemo(() => ask("a:" + s()));
      const b = createMemo(() => ask("b:" + s()));
      createRenderEffect(a, v => void (screen.a = String(v)));
      createRenderEffect(s, v => void (screen.s = String(v)));
      const out = untrack(() =>
        createLoadingBoundary(
          () => "b=" + b(),
          () => "loading b"
        )
      );
      createRenderEffect(out, v => void (screen.b = String(v)));
      return d;
    });
    flush();
    await tick();
    flights.get("a:0")!.resolve(10);
    await tick();
    frame();
    setS(1);
    flush();
    await tick();
    frame();
    flights.get("a:1")!.resolve(11);
    await tick();
    frame();
    flights.get("b:1")!.resolve(21);
    await tick();
    frame();
    dispose();
    expect(frames).toEqual([
      "a=10s=0loading b",
      "a=10s=0loading b",
      "a=11s=1loading b",
      "a=11s=1b=21"
    ]);
  });

  test("#4591: a rejection under an armed `on` boundary shows with the held write's commit", async () => {
    const flights = new Map<string, Flight>();
    const ask = (key: string) =>
      new Promise<number>((resolve, reject) => flights.set(key, { resolve, reject }));
    const [s0, setS0] = createSignal(0);
    const [s1, setS1] = createSignal(0);
    const cell = { a1: "", inner: "" };
    let screen = "";
    const frames: string[] = [];
    const dispose = createRoot(d => {
      const a0 = createMemo(() => ask("a0:" + s1()));
      const a1 = createMemo(() => ask("a1:" + s1()));
      const out = untrack(() =>
        createErrorBoundary(
          () => {
            createRenderEffect(a1, v => void (cell.a1 = `[a1=${v}]`));
            const inner = untrack(() =>
              createLoadingBoundary(
                () => `[a0=${a0()}][s1=${s1()}]`,
                () => "loading",
                { on: () => s0() }
              )
            );
            createRenderEffect(inner, v => void (cell.inner = String(v)));
            return "ok";
          },
          () => "error"
        )
      );
      createRenderEffect(out, v => void (screen = String(v)));
      return d;
    });
    const view = () => (screen === "error" ? "error" : cell.a1 + cell.inner);
    flush();
    await tick();
    flights.get("a1:0")!.resolve(9);
    flights.get("a0:0")!.resolve(10);
    await tick();
    frames.push(view());
    setS0(1);
    setS1(1);
    flush();
    await tick();
    frames.push(view());
    flights.get("a1:1")!.resolve(11);
    await tick();
    frames.push(view());
    setS0(2);
    setS1(2);
    flush();
    await tick();
    frames.push(view());
    flights.get("a0:2")!.reject(new Error("boom"));
    await tick();
    frames.push(view());
    flights.get("a1:2")!.resolve(12);
    await tick();
    frames.push(view());
    dispose();
    expect(frames).toEqual([
      "[a1=9][a0=10][s1=0]",
      "[a1=9][a0=10][s1=0]",
      "[a1=11]loading",
      "[a1=11]loading",
      "[a1=11]loading",
      "error"
    ]);
  });
  test("#4591 control: a value under an armed `on` boundary shows with the held write's commit", async () => {
    const flights = new Map<string, Flight>();
    const ask = (key: string) =>
      new Promise<number>((resolve, reject) => flights.set(key, { resolve, reject }));
    const [s0, setS0] = createSignal(0);
    const [s1, setS1] = createSignal(0);
    const cell = { a1: "", inner: "" };
    let screen = "";
    const frames: string[] = [];
    const dispose = createRoot(d => {
      const a0 = createMemo(() => ask("a0:" + s1()));
      const a1 = createMemo(() => ask("a1:" + s1()));
      const out = untrack(() =>
        createErrorBoundary(
          () => {
            createRenderEffect(a1, v => void (cell.a1 = `[a1=${v}]`));
            const inner = untrack(() =>
              createLoadingBoundary(
                () => `[a0=${a0()}][s1=${s1()}]`,
                () => "loading",
                { on: () => s0() }
              )
            );
            createRenderEffect(inner, v => void (cell.inner = String(v)));
            return "ok";
          },
          () => "error"
        )
      );
      createRenderEffect(out, v => void (screen = String(v)));
      return d;
    });
    const view = () => (screen === "error" ? "error" : cell.a1 + cell.inner);
    flush();
    await tick();
    flights.get("a1:0")!.resolve(9);
    flights.get("a0:0")!.resolve(10);
    await tick();
    frames.push(view());
    setS0(1);
    setS1(1);
    flush();
    await tick();
    frames.push(view());
    flights.get("a1:1")!.resolve(11);
    await tick();
    frames.push(view());
    setS0(2);
    setS1(2);
    flush();
    await tick();
    frames.push(view());
    flights.get("a0:2")!.resolve(20);
    await tick();
    frames.push(view());
    flights.get("a1:2")!.resolve(12);
    await tick();
    frames.push(view());
    dispose();
    expect(frames).toEqual([
      "[a1=9][a0=10][s1=0]",
      "[a1=9][a0=10][s1=0]",
      "[a1=11]loading",
      "[a1=11]loading",
      "[a1=11]loading",
      "[a1=12][a0=20][s1=2]"
    ]);
  });
});
