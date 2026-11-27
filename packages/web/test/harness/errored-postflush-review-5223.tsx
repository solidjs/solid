/**
 * @jsxImportSource @solidjs/web
 *
 * #5223 review shapes, a `<Loading>` deep in an `<Errored>` failing after the
 * shell, as the reviews of the first attempt found broken. Recorded by
 * test/server/hydration-harness.spec.tsx, replayed by
 * test/hydration/errored-nested-postflush-5223.spec.tsx. H1: an inner
 * direct-shape `<Errored>` whose `<Loading>` streamed owns a later failure in
 * it. H2: in a lazy component. H3: a `<NoHydration>` zone. H4/H4b: inside an
 * outer `<Loading>` settling with / just before the failure. H5: an
 * interactive sibling. H6: a sibling `<Loading>` that would succeed. H7: in
 * an `<svg>`, an SVG fallback.
 */
import { createMemo, createSignal, Errored, Loading, lazy, onSettled } from "solid-js";
import { NoHydration } from "@solidjs/web";

export const ctl: {
  asks: Record<string, number>;
  plan: Record<string, [number, "ok" | "fail", string]>;
  clicks: string[];
  effects: string[];
  lazyDelay: number;
} = { asks: {}, plan: {}, clicks: [], effects: [], lazyDelay: 0 };
const RealPromise = Promise;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// A read: it follows the plan, and counts each time it is asked on the real
// clock (the client; the server records on a fake one).
export function read(name: string) {
  return createMemo(async (): Promise<string> => {
    if (Promise === RealPromise) ctl.asks[name] = (ctl.asks[name] || 0) + 1;
    const [ms, kind, v] = ctl.plan[name];
    await sleep(ms);
    if (kind === "fail") throw new Error(v);
    return v;
  });
}
const Fb = (p: { tag: string; e: any }) => {
  onSettled(() => void ctl.effects.push(p.tag));
  return (
    <p onClick={() => ctl.clicks.push(p.tag)}>
      {p.tag}: {p.e().message}
    </p>
  );
};

export function H1() {
  const a = read("a");
  const b = read("b");
  return (
    <div>
      <Errored fallback={(e: any) => <Fb tag="OUTER" e={e} />}>
        <section>
          <h1 onClick={() => ctl.clicks.push("h1")}>keep</h1>
          <Errored fallback={(e: any) => <Fb tag="INNER" e={e} />}>
            <Loading fallback={<i>loading A</i>}>
              <div>
                {a()}
                <Loading fallback={<i>loading B</i>}>
                  <span>{b()}</span>
                </Loading>
              </div>
            </Loading>
          </Errored>
        </section>
      </Errored>
      <footer>tail</footer>
    </div>
  );
}

export function Inner() {
  const a = read("a");
  return (
    <Errored fallback={(e: any) => <Fb tag="E" e={e} />}>
      <b>
        <em onClick={() => ctl.clicks.push("em")}>title</em>
        <Loading fallback={<i>loading A</i>}>
          <span>{a()}</span>
        </Loading>
      </b>
    </Errored>
  );
}
const LazyInner = lazy(
  async () => {
    if (ctl.lazyDelay) await sleep(ctl.lazyDelay);
    return { default: Inner };
  },
  undefined,
  "src/Inner.tsx"
);
export function H2() {
  return (
    <div>
      <Loading fallback={<i>loading lazy</i>}>
        <LazyInner />
      </Loading>
      <footer>tail</footer>
    </div>
  );
}

export function H3() {
  return (
    <div>
      <NoHydration>
        <Inner />
      </NoHydration>
      <footer>tail</footer>
    </div>
  );
}

export function H4() {
  const o = read("o");
  const a = read("a");
  return (
    <div>
      <Loading fallback={<i>loading O</i>}>
        <article>
          {o()}
          <Errored fallback={(e: any) => <Fb tag="E" e={e} />}>
            <b>
              <em>title</em>
              <Loading fallback={<i>loading A</i>}>
                <span>{a()}</span>
              </Loading>
            </b>
          </Errored>
        </article>
      </Loading>
      <footer>tail</footer>
    </div>
  );
}

export function H5() {
  const a = read("a");
  const [n, setN] = createSignal(0);
  return (
    <div>
      <Errored fallback={(e: any) => <Fb tag="E" e={e} />}>
        <b>
          <button onClick={() => (ctl.clicks.push("btn"), setN(n() + 1))}>n={n()}</button>
          <Loading fallback={<i>loading A</i>}>
            <span>{a()}</span>
          </Loading>
        </b>
      </Errored>
      <footer>tail</footer>
    </div>
  );
}

function Sib() {
  const c = read("c");
  return (
    <Loading fallback={<i>loading C</i>}>
      <u>{c()}</u>
    </Loading>
  );
}
export function H6() {
  const a = read("a");
  return (
    <div>
      <Errored fallback={(e: any) => <Fb tag="E" e={e} />}>
        <b>
          <Sib />
          <Loading fallback={<i>loading A</i>}>
            <span>{a()}</span>
          </Loading>
        </b>
      </Errored>
      <footer>tail</footer>
    </div>
  );
}

export function H7() {
  const a = read("a");
  return (
    <div>
      <svg>
        <Errored
          fallback={(e: any) => (
            <circle
              data-error={e().message}
              cx="10"
              cy="10"
              r="5"
              onClick={() => ctl.clicks.push("E")}
            />
          )}
        >
          <g>
            <Loading fallback={<text>loading A</text>}>
              <text>{a()}</text>
            </Loading>
          </g>
        </Errored>
      </svg>
      <footer>tail</footer>
    </div>
  );
}

export const shapes: Record<string, () => any> = { H1, H2, H3, H4, H5, H6, H7 };
export const plans: Record<string, typeof ctl.plan> = {
  H1: { a: [5, "ok", "A"], b: [20, "fail", "boom"] },
  H2: { a: [20, "fail", "boom"] },
  H3: { a: [20, "fail", "boom"] },
  H4: { o: [10, "ok", "O"], a: [10, "fail", "boom"] },
  H4b: { o: [10, "ok", "O"], a: [20, "fail", "boom"] },
  H5: { a: [20, "fail", "boom"] },
  H6: { a: [20, "fail", "boom"], c: [60, "ok", "C"] },
  H7: { a: [20, "fail", "boom"] }
};
export const reviewName = (key: string) => `errored-postflush-review-${key}-5223`;
