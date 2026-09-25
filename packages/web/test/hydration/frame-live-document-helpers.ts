/**
 * Shared by the document-face hydration specs (frame-live-document*.spec.tsx):
 * artifact loading, chunk replay, and the room's server markup. Each spec
 * lives in its own file because the frames client's boundary index and
 * claim set are module state — one page per module instance.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { flush } from "solid-js";

const artifactsDir = resolve(dirname(fileURLToPath(import.meta.url)), "../harness/__artifacts__");

export function loadArtifact(name: string): { shell: string; rest: string } {
  const file = resolve(artifactsDir, `${name}.json`);
  if (!existsSync(file)) {
    throw new Error(
      `Missing artifact "${name}". Run the server spec first: ` +
        `vitest run --config vite.config.server.mjs test/server/frame-live-document-artifact.spec.tsx`
    );
  }
  return JSON.parse(readFileSync(file, "utf-8"));
}

export function applyChunk(container: HTMLElement, chunk: string, first: boolean) {
  const scriptRe = /<script(?:[^>]*)>([\s\S]*?)<\/script>/g;
  const scripts = [...chunk.matchAll(scriptRe)].map(m => m[1]);
  const stripped = chunk.replace(scriptRe, "");
  if (first) container.innerHTML = stripped;
  else container.insertAdjacentHTML("beforeend", stripped);
  for (const s of scripts) (0, eval)(s);
}

export async function drain() {
  for (let i = 0; i < 40; i++) await Promise.resolve();
  flush();
  for (let i = 0; i < 40; i++) await Promise.resolve();
  flush();
}

/** The room's server render for a title, with the composer slot's range. */
export function roomHtml(title: string) {
  return (
    `<article><h1>${title}</h1>` +
    "<ul><!--slot:composer#0:start--><!--slot:composer#0:end--></ul>" +
    "</article>"
  );
}
