// Type-level drift guard for the client-side server mock: every mock
// signature must stay MUTUALLY assignable with the runtime's real server
// declarations, so the isomorphic surface the client build type-checks
// against cannot silently diverge from what the server build executes
// (the ssrClassList/onHead/manifest drift class of bug). Compile-only —
// runs under `test-types` (tsconfig.test.json); published types never
// reference these source-relative imports.
import * as mock from "../src/server-mock.js";
import type * as runtime from "../src/server.js";

// Mutual assignability: mock usable where the runtime type is expected, and
// the runtime implementation satisfying the mock's declared type — drift in
// either direction fails to compile.
function mutual<T>(a: T, b: NoInfer<T>): [T, T] {
  return [a, b];
}
declare const rt: typeof runtime;

// Render entry points.
mutual<typeof rt.renderToString>(mock.renderToString, rt.renderToString);
mutual<typeof rt.renderToStream>(mock.renderToStream, rt.renderToStream);
// renderToStringAsync is deleted — its replacement is awaiting the stream.
// @ts-expect-error renderToStringAsync must not exist on the mock
mock.renderToStringAsync;

// The awaited form must typecheck without casts.
async function _awaitedStream() {
  const html: string = await mock.renderToStream(() => null);
  return html;
}

// Response-head lifecycle / middleware surface.
mutual<typeof rt.createResponseStub>(mock.createResponseStub, rt.createResponseStub);
mutual<typeof rt.createRequestEvent>(mock.createRequestEvent, rt.createRequestEvent);
mutual<typeof rt.getExpectedRedirectStatus>(
  mock.getExpectedRedirectStatus,
  rt.getExpectedRedirectStatus
);
mutual<typeof rt.createSSRResponse>(mock.createSSRResponse, rt.createSSRResponse);
mutual<typeof rt.commitEventResponse>(mock.commitEventResponse, rt.commitEventResponse);
mutual<typeof rt.composeMiddleware>(mock.composeMiddleware, rt.composeMiddleware);
mutual<runtime.FetchMiddleware>(
  null as unknown as mock.FetchMiddleware,
  null as unknown as runtime.FetchMiddleware
);

// createRequestEvent keeps its extension generic.
declare const req: Request;
const evt = mock.createRequestEvent(req, { complete: false as boolean });
evt.complete satisfies boolean;
evt.response.committed satisfies boolean | undefined;

// Compiler SSR primitives.
mutual<typeof rt.ssr>(mock.ssr, rt.ssr);
mutual<typeof rt.ssrElement>(mock.ssrElement, rt.ssrElement);
mutual<typeof rt.ssrClassName>(mock.ssrClassName, rt.ssrClassName);
mutual<typeof rt.ssrStyle>(mock.ssrStyle, rt.ssrStyle);
mutual<typeof rt.ssrStyleProperty>(mock.ssrStyleProperty, rt.ssrStyleProperty);
mutual<typeof rt.ssrAttribute>(mock.ssrAttribute, rt.ssrAttribute);
mutual<typeof rt.ssrGroup>(mock.ssrGroup, rt.ssrGroup);
mutual<typeof rt.ssrHydrationKey>(mock.ssrHydrationKey, rt.ssrHydrationKey);
mutual<typeof rt.resolveSSRNode>(mock.resolveSSRNode, rt.resolveSSRNode);
mutual<typeof rt.escape>(mock.escape, rt.escape);

// Manifest option forms stay in lockstep.
mutual<runtime.PreloadLink>(
  null as unknown as mock.PreloadLink,
  null as unknown as runtime.PreloadLink
);
mutual<runtime.AssetManifest>(
  null as unknown as mock.AssetManifest,
  null as unknown as runtime.AssetManifest
);
mutual<runtime.ResolvedAssets>(
  null as unknown as mock.ResolvedAssets,
  null as unknown as runtime.ResolvedAssets
);
mutual<runtime.AssetResolver>(
  null as unknown as mock.AssetResolver,
  null as unknown as runtime.AssetResolver
);
mutual<runtime.AssetResolverFn>(
  null as unknown as mock.AssetResolverFn,
  null as unknown as runtime.AssetResolverFn
);

export {};
