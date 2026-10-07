/**
 * @jsxImportSource @solidjs/web
 *
 * The cross arm: the `dynamicComponent` document hydrated through `dynamic`
 * — the two entry points share one owner shape, so a document either
 * rendered is a document either hydrates. Inline variant. One page per
 * file: the frames client's boundary index is module state. See
 * ./dynamic-component-parity-run.tsx.
 */
import { test } from "vitest";
import { runParity } from "./dynamic-component-parity-run.jsx";

test("dynamicComponent document, hydrated through dynamic — inline", async () => {
  await runParity("inline", "dynamic");
});
