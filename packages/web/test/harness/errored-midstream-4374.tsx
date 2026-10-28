/**
 * @jsxImportSource @solidjs/web
 *
 * #4374: an `<Errored>` nested under other Erroreds inside a `<Loading>`,
 * its content reading a sync memo `b` that throws once the async memo `a`
 * lands. The server streams the Loading's fragment as the innermost
 * fallback, with `a`'s value and `b`'s error, then a sibling `<i>`. `root` puts an Errored above
 * the Loading, `outer` one between the Loading and the inner Errored (the
 * issue has both; neither is the control). A client write to `k` changes
 * `a`'s input, and the boundary recovers with its content.
 *
 * Compiled with both generates: test/server/errored-midstream-4374.gen.spec.tsx
 * writes the chunks test/hydration/errored-midstream-4374.spec.tsx replays.
 */
import { createMemo, createSignal, Errored, Loading } from "solid-js";
import { isServer } from "@solidjs/web";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const RealPromise = Promise;

export type NestedErroredShape = { root: boolean; outer: boolean };
export const nestedErroredShapes: NestedErroredShape[] = [
  { root: true, outer: true },
  { root: true, outer: false },
  { root: false, outer: true },
  { root: false, outer: false }
];
export const nestedErroredName = (o: NestedErroredShape) =>
  `errored-midstream-4374${o.root ? "-root" : ""}${o.outer ? "-outer" : ""}`;

// The same region with no Errored: the Loading's text fallback, then
// content whose text follows an element. Pins the hole's bookkeeping, not
// the boundaries.
export function createTextAfterElementApp() {
  const [k, setK] = createSignal(1);
  let asks = 0;
  function App() {
    const a = createMemo(async () => {
      const v = k();
      if (!isServer && Promise === RealPromise) asks++;
      await sleep(10);
      return v;
    });
    return (
      <main>
        <Loading fallback="[LOAD]">
          <i>sib</i>
          {"a" + a()}
        </Loading>
      </main>
    );
  }
  return { App, write: (v: number) => setK(v), asks: () => asks };
}

export function createNestedErroredApp(o: NestedErroredShape) {
  const [k, setK] = createSignal(1);
  let asks = 0;
  function App() {
    const a = createMemo(async () => {
      const v = k();
      if (!isServer && Promise === RealPromise) asks++;
      await sleep(10);
      return v;
    });
    const b = createMemo(() => {
      if (a() === 1) throw new Error("boom");
      return a();
    });
    // Each shape spelled out: the boundaries sit directly in <main>, no
    // insert markers around them.
    const Inner = () => (
      <Errored fallback={(_e: unknown) => "[INNER]"}>
        <span>{b()}</span>
      </Errored>
    );
    if (o.root && o.outer)
      return (
        <main>
          <Errored fallback={(_e: unknown) => "[ROOT]"}>
            <Loading fallback="[LOAD]">
              <Errored fallback={(_e: unknown) => "[OUTER]"}>
                <Inner />
              </Errored>
              <i>sib</i>
            </Loading>
          </Errored>
        </main>
      );
    if (o.root)
      return (
        <main>
          <Errored fallback={(_e: unknown) => "[ROOT]"}>
            <Loading fallback="[LOAD]">
              <Inner />
              <i>sib</i>
            </Loading>
          </Errored>
        </main>
      );
    if (o.outer)
      return (
        <main>
          <Loading fallback="[LOAD]">
            <Errored fallback={(_e: unknown) => "[OUTER]"}>
              <Inner />
            </Errored>
            <i>sib</i>
          </Loading>
        </main>
      );
    return (
      <main>
        <Loading fallback="[LOAD]">
          <Inner />
          <i>sib</i>
        </Loading>
      </main>
    );
  }
  return { App, write: (v: number) => setK(v), asks: () => asks };
}
