/**
 * @jsxImportSource @solidjs/web
 *
 * The cross arm, streamed: the `dynamicComponent` document hydrated through
 * `dynamic`, the frame landing as a late fragment after hydrate. One page
 * per file: the frames client's boundary index is module state. See
 * ./dynamic-component-parity-run.tsx.
 */
import { test } from "vitest";
import { runParity } from "./dynamic-component-parity-run.jsx";

test("dynamicComponent document, hydrated through dynamic — streamed", async () => {
  await runParity("streamed", "dynamic");
});
