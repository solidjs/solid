/**
 * @jsxImportSource @solidjs/web
 *
 * `dynamicComponent` hydrates the `dynamicComponent` document — streamed
 * variant: the fallback is in the shell, the frame lands as a late fragment
 * after hydrate, with its `_fr` record. One page per file: the frames
 * client's boundary index is module state. See
 * ./dynamic-component-parity-run.tsx.
 */
import { test } from "vitest";
import { runParity } from "./dynamic-component-parity-run.jsx";

test("dynamicComponent document, hydrated through dynamicComponent — streamed", async () => {
  await runParity("streamed", "dynamicComponent");
});
