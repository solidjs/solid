/**
 * @jsxImportSource @solidjs/web
 *
 * #4042: two sites of one server function whose site ids are minted in a
 * different order on the server than the client mounts them. The preview
 * sits behind async setup, so the server renders the docs site first (it
 * takes the bare id) and the preview second (`~2`); on the client the setup
 * value is already in the hydration data, so the preview mounts first.
 * Each site must still adopt its own element, and an update to the preview
 * must land in the preview.
 *
 * Shared by test/server/site-order-hydration-4042.spec.tsx (ssr compile, an
 * in-process answer per call) and test/hydration/site-order-hydration-4042.spec.tsx
 * (dom compile, the same tree over the server reference).
 */
import { createMemo, createSignal, Loading, Show } from "solid-js";
import { dynamic } from "@solidjs/web";

export const FID = "site-order-4042";
export const ARTIFACT = "site-order-hydration-4042";

export function makeApp(
  render: (text: string) => any,
  onPreview?: (set: (text: string) => void) => void
) {
  function Block(props: { text: string }) {
    const Content = dynamic(() => render(props.text));
    return <Content />;
  }
  function Preview() {
    const [source, setSource] = createSignal("preview original");
    onPreview?.(setSource);
    return (
      <section id="preview">
        <Block text={source()} />
      </section>
    );
  }
  return function App() {
    const ready = createMemo(async () => true);
    return (
      <Loading fallback="loading">
        <Show when={ready()}>
          <Preview />
        </Show>
        <section id="docs">
          <Block text="documentation" />
        </section>
      </Loading>
    );
  };
}
