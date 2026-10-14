/**
 * @jsxImportSource @solidjs/web
 *
 * #3889: one server-component factory mounted at two sites. Each site passes
 * the same client `Counter`; after hydration both buttons must still be in
 * the document and click independently.
 *
 * Shared by test/server/multisite-hydration-3889.spec.tsx (ssr compile,
 * in-process factory) and test/hydration/multisite-hydration-3889.spec.tsx
 * (dom compile, the same tree over the server reference).
 */
import { createMemo, createSignal, Loading } from "solid-js";
import { dynamic } from "@solidjs/web";

export const FID = "multisite-3889";
export const ARTIFACT = "multisite-hydration-3889";

/** Local client slot: its own signal, so two mounts must not share a count. */
export function Counter() {
  const [count, setCount] = createSignal(0);
  return <button onClick={() => setCount(n => n + 1)}>{count()}</button>;
}

/** The factory the endpoint returns: `props => <props.counter />`. */
export function makeMultisite() {
  return (props: { counter: typeof Counter }) => <props.counter />;
}

/**
 * The reporter's tree: the source runs once (the shared factory), `dynamic`
 * mounts it twice, each time with the client counter.
 */
export function makeApp(source: () => any) {
  return function App() {
    const value = createMemo(() => source());
    const Frame = dynamic(() => value() as any);
    return (
      <Loading fallback="pending">
        <Frame counter={Counter} />
        <Frame counter={Counter} />
      </Loading>
    );
  };
}
