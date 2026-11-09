import { expect, it } from "vitest";
import {
  createLoadingBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush
} from "../src/index.js";

// #4541: a node that re-parks drops the sources its pass no longer reaches.
// `b`'s first flight is superseded by a synchronous answer while a sibling `a`
// refetches under the same boundary. The answer is staged (first value, still
// uninitialized until its commit), so b's own settle walk does not run; its
// readers re-derive instead. The boundary's tree, reading both, re-parks on
// `a` — and carried `b` forward: no dependency of it reached `b` any more, so
// `a`'s landing left it waiting on `b` forever and the fallback never went
// away (F-1: a settled frame reveals).
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

function show(when: () => any, child: () => any) {
  const value = createMemo(() => when());
  const cond = createMemo(value, { equals: (x: any, y: any) => !x === !y, sync: true } as any);
  return createMemo(() => (cond() ? child() : undefined), { sync: true } as any);
}

async function run(refetchA: boolean) {
  const [aV, setAV] = createSignal(0);
  const [bV, setBV] = createSignal(0);
  let aFlight: Promise<string> | null = null;
  let releaseA: (v: string) => void = () => {};
  let bValue: string | null = null;
  const bFlight = new Promise<string>(() => {});
  let out: any;
  createRoot(() => {
    const a = createMemo(() => (aV(), aFlight ?? "A"));
    const b = createMemo(() => (bV(), bValue ?? bFlight.then(v => v)));
    const text = (tag: string, s: () => any) => () => {
      const n = { tag, text: "" };
      createRenderEffect(s, v => {
        n.text = v;
      });
      return n;
    };
    const boundary = createLoadingBoundary(
      () => [show(b, text("i", b)), show(a, text("b", a))],
      () => "wait"
    );
    createRenderEffect(
      () => {
        const r = boundary();
        return Array.isArray(r) ? r.map(f => (typeof f === "function" ? f() : f)) : r;
      },
      v => {
        out = v;
      }
    );
  });
  flush();
  await wait(10);
  if (refetchA) {
    aFlight = new Promise<string>(r => (releaseA = r));
    setAV(1);
  }
  await wait(0);
  bValue = "B";
  setBV(1);
  await wait(20);
  if (refetchA) {
    aFlight = null;
    releaseA("A");
    setAV(2);
  }
  await wait(50);
  flush();
  return Array.isArray(out)
    ? out.map((n: any) => n && `<${n.tag}>${n.text}</${n.tag}>`).join("")
    : out;
}

it("control: without a sibling refetch the content reveals (#4541)", async () => {
  expect(await run(false)).toBe("<i>B</i><b>A</b>");
});

it("a superseded first answer beside a sibling refetch still reveals (#4541)", async () => {
  expect(await run(true)).toBe("<i>B</i><b>A</b>");
});
