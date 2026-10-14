/**
 * @jsxImportSource @solidjs/web
 *
 * `dynamicComponent` hydrates the `dynamicComponent` document — a client
 * component and a non-live server component, inline (settled before the
 * shell flush). One page per file: the frames client's boundary index is
 * module state. See ./dynamic-component-parity-run.tsx.
 */
import { test } from "vitest";
import { runParity } from "./dynamic-component-parity-run.jsx";

test("dynamicComponent document, hydrated through dynamicComponent — inline", async () => {
  await runParity("inline", "dynamicComponent");
});
