/**
 * @jsxImportSource @solidjs/web
 *
 * #3932: one server function called at three sites with different arguments,
 * the docs-page shape (a highlighted block per call). Each call returns its
 * own component. Hydration must adopt every site; the later calls must not
 * refetch.
 *
 * Shared by test/server/multicall-hydration-3932.spec.tsx (ssr compile, an
 * in-process answer per call) and test/hydration/multicall-hydration-3932.spec.tsx
 * (dom compile, the same tree over the server reference).
 */
import { Loading } from "solid-js";
import { dynamic } from "@solidjs/web";

export const FID = "multicall-3932";
export const ARTIFACT = "multicall-hydration-3932";
export const TEXTS = ["one", "two", "three"] as const;

/**
 * The reporter's tree: each block calls the same function with its own
 * text. `render` is the server's in-process answer on one side and the
 * client reference on the other.
 */
export function makeApp(render: (text: string) => any) {
  function Block(props: { text: string }) {
    const Content = dynamic(() => render(props.text));
    return <Content />;
  }
  return function App() {
    return (
      <Loading fallback="loading">
        <Block text="one" />
        <Block text="two" />
        <Block text="three" />
      </Loading>
    );
  };
}
