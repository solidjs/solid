/**
 * @jsxImportSource @solidjs/web
 *
 * Shared by the frame-nested-fill-context*.spec.tsx hydrate specs: boots the
 * document test/server/frame-nested-fill-context.spec.tsx rendered and
 * hydrates it. Each spec lives in its own file because the frames client's
 * boundary index and claim set are module state — one page per module.
 */
import { expect, vi } from "vitest";
import { flush } from "solid-js";
import { hydrate } from "@solidjs/web";
import { installServerComponents } from "../../frames/src/client.js";
import { prepareTier } from "../../frames/src/frame-client.js";
import { createServerReference } from "../../server-functions/src/client.js";
import { makeHost } from "../lifecycle-matrix/harness.js";
import { ARGS, FID, makeApp } from "../harness/frame-nested-fill-context.jsx";
import { applyChunk, drain, loadArtifact } from "./frame-live-document-helpers.js";

export async function bootNestedContext() {
  const { shell, rest } = loadArtifact("frame-nested-fill-context");
  (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: {}, fe() {} };
  const container = document.createElement("div");
  document.body.appendChild(container);
  installServerComponents(makeHost().host);
  vi.stubGlobal("fetch", async () => {
    throw new Error("unexpected fetch");
  });
  const warnings: string[] = [];
  vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
    warnings.push(args.map(String).join(" "));
  });
  const errors: string[] = [];
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errors.push(args.map(String).join(" "));
  });
  const list = createServerReference(FID);
  const App = makeApp(() => list(...ARGS));
  applyChunk(container, shell + rest, true);
  // The panel's content is a `{$frame}` region: the tier is resident, as on
  // a page whose modulepreload landed.
  await prepareTier("regions");
  const badge = (id: string) => container.querySelector<HTMLButtonElement>(`#badge-${id}`)!;
  const server = {
    in: badge("in"),
    out: badge("out"),
    panel: container.querySelector("section.panel")!
  };
  expect(server.in.textContent).toBe("dark:0");
  expect(server.out.textContent).toBe("default:0");
  const dispose = hydrate(() => <App />, container);
  const click = async (id: string) => {
    badge(id).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    flush();
    await drain();
  };
  const toggle = async (id: string) => {
    container.querySelector<HTMLButtonElement>(`#toggle-${id}`)!.click();
    flush();
    await drain();
  };
  return { container, badge, server, click, toggle, warnings, errors, dispose, drain };
}
