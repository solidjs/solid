import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "vitest";

// The merge()/omit() view protocol and the server-scope seams are consumed by
// `@solidjs/web` / `@solidjs/universal` through `solid-js/internal`. They are
// exported from the main entries at runtime (so that subpath shares this
// module's state) but marked `@internal`, and `stripInternal` keeps them out
// of the DECLARATIONS — that is what makes them not-public for TypeScript.
//
// This pins the boundary: a name added back to a main entry without an
// `@internal` tag fails here, which is how #3454 leaked eleven of these onto
// the `solid-js` surface without anyone noticing.
const INTERNAL = [
  // view protocol (pure @solidjs/signals, re-exported by src/internal.ts)
  "mergeSources",
  "mergeView",
  "omitView",
  "viewOf",
  "OmitView",
  "MergeView",
  "sourceKeys",
  "sourceHas",
  "sourceGet",
  "hasStaticKeys",
  "resolvedTable",
  "SOURCE_PLAIN",
  "SOURCE_OMIT",
  "SOURCE_PROXY",
  "SOURCE_MEMO",
  "SourceKind",
  // server-scope seams (real on the server entry, stubs on the client)
  "ssrHandleError",
  "ssrScope",
  "runInServerComponentScope",
  "inServerComponentScope",
  "creationStamp",
  "getProjectionTrace",
  // boundary primitives behind Errored/Loading/Reveal (#3709)
  "createErrorBoundary",
  "createLoadingBoundary",
  "createRevealOrder",
  // hydration/SSR coordination object and the dev component brand
  "sharedConfig",
  "$DEVCOMP",
  // tag-arm core behind dynamicComponent / @solidjs/web dynamic (#3907)
  "dynamicCore"
];

// The container-trace materializer's seams: exported from the client entry at
// runtime (so `solid-js/internal/container-trace` shares this module's
// state), `@internal`, and declared NOWHERE public — that entry types them
// itself. The patch protocol, and the hydration helpers the store adapter
// module that entry bundles its own copy of (client/store-hydration.ts)
// reads back from the one `solid-js` instance. Checked against the main
// declarations only.
const CONTAINER_TRACE_SEAMS = [
  "applyPatches",
  "forwardIteratorReturn",
  "readSerializedOrCompute",
  "subFetch",
  "readHydratedValue",
  "wrapFirstYield",
  "adoptedAnswerStream",
  "withHydrationGate",
  "onHydrationEnd",
  "noHydrationId",
  "markTopLevelSnapshotScope",
  "hasLoadingWindow",
  "isAsyncIterable",
  "syncThenable",
  "UNASKED"
];

const typesDir = resolve(import.meta.dirname, "../types");
const read = (file: string) => readFileSync(resolve(typesDir, file), "utf8");
// `\b` cannot bound a name that starts with `$`; bound on identifier characters.
const mentions = (declarations: string, name: string) =>
  new RegExp(`(?<![\\w$])${name.replace(/\$/g, "\\$")}(?![\\w$])`).test(declarations);

test.each([
  ["client", "index.d.ts"],
  ["server", "server/index.d.ts"]
])("no internal name reaches the %s entry's declarations", (_tier, file) => {
  const declarations = read(file);
  const leaked = [...INTERNAL, ...CONTAINER_TRACE_SEAMS, "materializeContainerTrace"].filter(name =>
    mentions(declarations, name)
  );
  expect(leaked).toEqual([]);
});

test("solid-js/internal's declarations carry the protocol and the seams", () => {
  const declarations = read("internal.d.ts");
  const missing = INTERNAL.filter(name => !mentions(declarations, name));
  expect(missing).toEqual([]);
});

// The materializer is its own entry (the store engine it builds on must be
// assignable to a lazy chunk, which a re-export from the flat main module or
// from `solid-js/internal` would prevent); the subpath declares it, and
// neither eager entry does.
test("solid-js/internal/container-trace declares the materializer; solid-js/internal does not", () => {
  expect(mentions(read("client/container-trace.d.ts"), "materializeContainerTrace")).toBe(true);
  expect(mentions(read("internal.d.ts"), "materializeContainerTrace")).toBe(false);
});
