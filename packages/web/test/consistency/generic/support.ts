/**
 * Shared support for the generic (frames-free) hydration consistency pins
 * and harness: the server artifacts of test/harness/generic-hydration.tsx,
 * the streaming-parse stand-in, and the page handle the pins and the
 * runner drive.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { vi } from "vitest";
import { flush } from "solid-js";
import { sharedConfig } from "solid-js/internal";
import type { Order } from "../../harness/generic-hydration.jsx";

const here = dirname(fileURLToPath(import.meta.url));

export interface Artifact {
  shell: string;
  chunks: string[];
}

const artifacts = new Map<Order, Artifact>();
/** `__artifacts__/generic-hydration-<order>.json`, rendered by test/server/generic-hydration.gen.spec.tsx. */
export function loadArtifact(order: Order): Artifact {
  let a = artifacts.get(order);
  if (!a) {
    a = JSON.parse(
      readFileSync(
        resolve(here, `../../harness/__artifacts__/generic-hydration-${order}.json`),
        "utf-8"
      )
    ) as Artifact;
    artifacts.set(order, a);
  }
  return a;
}

/**
 * A streamed chunk parsing: markup appended, then its inline scripts run —
 * what a streaming browser parse does, one chunk at a time.
 */
export function applyChunk(container: HTMLElement, chunk: string, first = false) {
  const scriptRe = /<script(?:[^>]*)>([\s\S]*?)<\/script>/g;
  const scripts = [...chunk.matchAll(scriptRe)].map(m => m[1]);
  const stripped = chunk.replace(scriptRe, "");
  if (first) container.innerHTML = stripped;
  else container.insertAdjacentHTML("beforeend", stripped);
  for (const s of scripts) (0, eval)(s);
}

/** The fragment key a chunk reveals (`$df("K")`), if any. */
export function revealedKey(chunk: string): string | undefined {
  return /\$df\("([^"]+)"\)/.exec(chunk)?.[1];
}

export const macrotask = () => new Promise<void>(r => setTimeout(r));
export const microtask = () => Promise.resolve();
/** Flush, a macrotask, flush — repeated: the drain's own setTimeout needs a round. */
export async function quiesce(rounds = 3) {
  for (let i = 0; i < rounds; i++) {
    flush();
    await macrotask();
  }
  flush();
}

/** Fresh `_$HY` the way the server bootstrap leaves it, plus console spies. */
export function bootHy(extra: Record<string, unknown> = {}) {
  const hy: any = { events: [], completed: new WeakSet(), r: {}, fe() {}, ...extra };
  (globalThis as any)._$HY = hy;
  return hy;
}

export function spyConsole() {
  const warnings: string[] = [];
  const errors: string[] = [];
  const warn = vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
    warnings.push(args.map(String).join(" "));
  });
  const error = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errors.push(args.map(String).join(" "));
  });
  return {
    warnings,
    errors,
    restore() {
      warn.mockRestore();
      error.mockRestore();
    }
  };
}

/**
 * The bootstrap's event capture, in shape (web/src/server.ts
 * `generateHydrationScript`): a configured event on a server-rendered
 * element is queued at its nearest `_hk` ancestor unless that ancestor is
 * already claimed — and nothing is captured once `_$HY.events` is gone.
 */
export function installBootstrapCapture(root: Element, types = ["click"]) {
  const handler = (e: Event) => {
    const hy = (globalThis as any)._$HY;
    if (!hy || !hy.events) return;
    let n: Node | null = e.target as Node;
    while (n && !(n.nodeType === 1 && (n as Element).hasAttribute("_hk"))) n = n.parentNode;
    if (n && !hy.completed.has(n)) hy.events.push([n, e]);
  };
  for (const t of types) root.addEventListener(t, handler, true);
  return () => {
    for (const t of types) root.removeEventListener(t, handler, true);
  };
}

export const hydrationInProgress = () =>
  !!(sharedConfig as any).isHydrationInProgress && (sharedConfig as any).isHydrationInProgress();
export const onHydrationEnd = (cb: () => void) => (sharedConfig as any).onHydrationEnd(cb);

export const textOf = (n: Element | null | undefined) => (n ? (n.textContent ?? "") : null);
