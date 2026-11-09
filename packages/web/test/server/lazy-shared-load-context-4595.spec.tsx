/**
 * @jsxImportSource @solidjs/web
 *
 * #4595: concurrent awaited renderToStream()s that share a lazy()
 * component's first load resume their root holes without restoring the
 * render's `sharedConfig.context` — the resumed body runs under whichever
 * render set the global last, so an async memo created there records into
 * (and adopts from) another render's slot store under the same hydration
 * id and serves that render's value.
 */
import { expect, test } from "vitest";
import { renderToStream } from "@solidjs/web";
import { createMemo, lazy } from "solid-js";

const later = <T,>(value: T, ms: number) => new Promise<T>(r => setTimeout(() => r(value), ms));

// Each render's page: its own tag, and an async memo resolving to it.
function Page(props: { tag: string }) {
  const bag = createMemo(() => later({ tag: props.tag }, 5));
  return (
    <main>
      <p id="v">{`${props.tag}:${bag().tag}`}</p>
    </main>
  );
}

// Module-level `lazy()`, as a router's lazy route is: the six concurrent
// renders below share its first load.
const LazyPage = lazy(async () => ({ default: Page }));

test("concurrent awaited renders sharing a lazy()'s first load each read their own async memo's value", async () => {
  const tags = ["a", "b", "c", "d", "e", "f"];
  const pages = await Promise.all(
    tags.map(tag => renderToStream(() => <LazyPage tag={tag} />, { manifest: {} }).then(String))
  );
  const seen = pages.map(html => /<p id="v">(?:<!--[^>]*-->)*([^<]*)/.exec(html)?.[1]);
  expect(seen).toEqual(tags.map(tag => `${tag}:${tag}`));
});
