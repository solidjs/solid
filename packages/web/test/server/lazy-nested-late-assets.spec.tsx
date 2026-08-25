/**
 * @jsxImportSource @solidjs/web
 */
// Regression coverage for the cold-boot hydration halt (dead page on first
// visit to a nested-lazy route on a fresh server process).
//
// The shape: a lazy page under a lazy layout, both with callsite moduleUrls
// (the bundler-plugin transformLazy shape) and both COLD (module promises not
// yet cached process-wide). A lazy with a moduleUrl registers its
// hydration-id → asset mapping synchronously at component creation, so the
// registration timeline follows the CREATION timeline:
//
//   - the layout is created during boundary discovery → registered before
//     `commitBoundaryState` writes the boundary's `<id>_assets` map;
//   - the page is created only when the layout's template renders its
//     children — on a cold cache that happens in the template-hole drain
//     loop, AFTER the boundary's first `_assets` serialization.
//
// The map is one mutable shared object. Seroval's streaming serializer
// dedupes repeated object references, so handing it the same live map again
// at fragment flush emitted a bare back-reference ($R[n]) to the stale first
// snapshot: the page's mapping was silently dropped, the client never learned
// the nested chunk's hydration id, and `lazyHydrationLookup` threw
// REACTIVITY_HALTED — a dead page on first visit. (A warm cache renders the
// layout synchronously at discovery, so the page registers before the first
// write and nothing is lost — which is why only cold boots halted.) Both
// serialization sites now write a SNAPSHOT (`{ ...map }`) so every emission
// carries the map's current contents.
import { describe, expect, test } from "vitest";
import { renderToStream, Loading } from "@solidjs/web";
import { lazy } from "solid-js";

function renderComplete(code: () => any, options: any = {}): Promise<string> {
  return new Promise(resolve => {
    renderToStream(code, options).then(resolve);
  });
}

// Production manifest shape: answers synchronously.
const syncManifest = (moduleUrl: string) => ({
  js: [`/assets/${moduleUrl.replace(/[^a-z]/gi, "")}.js`],
  css: []
});

describe("nested lazy under a lazy layout on a cold module cache", () => {
  test("a module registered after the boundary's first _assets write survives the flush re-emission", async () => {
    let resolveLayout!: (mod: any) => void;
    let resolvePage!: (mod: any) => void;
    const layoutModule = new Promise<any>(r => (resolveLayout = r));
    const pageModule = new Promise<any>(r => (resolvePage = r));

    // Callsite moduleUrls (third argument): registration is synchronous at
    // component creation, as with bundler-transformed lazy() calls.
    const Layout = lazy(() => layoutModule, undefined, "./Layout.tsx");
    const Page = lazy(() => pageModule, undefined, "./NestedPage.tsx");

    // Cold cache: the layout module lands after discovery converges (so the
    // boundary commits its first _assets write with only the layout's
    // registration), and the page module later still.
    setTimeout(() => resolveLayout({ default: (props: any) => <main>{props.children}</main> }), 10);
    setTimeout(() => resolvePage({ default: () => <b>nested-page</b> }), 25);

    const html = await renderComplete(
      () => (
        <Loading fallback={<span>waiting</span>}>
          <Layout>
            <Page />
          </Layout>
        </Loading>
      ),
      { manifest: syncManifest }
    );

    expect(html).toContain("nested-page");

    // The nested page's mapping must be present in the streamed hydration
    // data. Its asset URL appears ONLY through the `_assets` registry write
    // (no modulepreload hint exists for it in this harness), so plain
    // containment pins the invariant: the flush re-emission must carry the
    // late-registered key instead of deduping to a back-reference of the
    // boundary's earlier (pre-drain) snapshot.
    expect(html).toContain("/assets/Layouttsx.js");
    expect(html).toContain("/assets/NestedPagetsx.js");
  });
});
