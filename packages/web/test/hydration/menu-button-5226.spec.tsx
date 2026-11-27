/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * #5226: hydration-id drift leaves the server-rendered menu button dead.
 *
 * The app that found this rendered a navigation rail's menu button through
 * a chain of component boundaries — custom-element wrappers, a tooltip
 * component whose internal non-keyed <Show> takes its fallback, a
 * dynamic() native button, unrendered <Show> branches that still reserve
 * ids — and hydrated the full document at the document root. The tooltip's
 * focus primitive returns early on the server, so the three id consumers
 * it creates on the client (the onSettled tracked effect and the two
 * event-listener effects) shift the client's key sequence three past the
 * server's: every keyed claim after the gate misses, the server-rendered
 * chain stays unclaimed, and the client builds a detached clone holding
 * all the handlers — the visible button is dead, in development and
 * (silently, all checks being dev-only) in production.
 *
 * The aligned control runs the same chain with the primitive's allocations
 * present on both builds: the server's onSettled stub and mock effects
 * consume the same three ids, the keys agree, the whole chain claims, and
 * the server-rendered button is interactive.
 *
 * test/server/menu-button-5226.spec.tsx records both artifacts; this spec
 * replays them (document.write, hydrate at the document root — the
 * vite-plugin `start` shape) and drives a real click.
 */
import { describe, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { flush } from "solid-js";
import { hydrate } from "@solidjs/web";
import {
  MenuButtonChain,
  MenuButtonChainAligned,
  MenuButtonDocument
} from "../harness/scenarios.jsx";

const artifactsDir = resolve(dirname(fileURLToPath(import.meta.url)), "../harness/__artifacts__");
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function loadDocument(name: string): string {
  const { shell, chunks } = JSON.parse(readFileSync(resolve(artifactsDir, `${name}.json`), "utf8"));
  return shell + (chunks ?? []).join("");
}

async function settle() {
  await sleep(30);
  flush();
  await sleep(10);
  flush();
}

/**
 * Hydrate the recorded document at the document root and return the server
 * nodes captured before the claim, plus the disposer.
 */
async function hydrateDocument(name: string, App: () => unknown) {
  (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: {}, fe() {} };
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  document.write(loadDocument(name));
  document.close();
  const serverNodes = new Set(
    [...document.querySelectorAll("[_hk]")].concat([document.documentElement])
  );
  const serverButton = document.querySelector("button")!;
  const dispose = hydrate(
    () => (
      <MenuButtonDocument>
        <App />
      </MenuButtonDocument>
    ),
    document
  );
  flush();
  await settle();
  return { warn, serverNodes, serverButton, dispose };
}

function cleanup() {
  delete (globalThis as any)._$HY;
  document.body.innerHTML = "";
  document.head.innerHTML = "";
}

describe("#5226 menu-button chain — document-root hydration", () => {
  test("aligned: the server-rendered button is claimed and interactive", async () => {
    const { warn, serverNodes, serverButton, dispose } = await hydrateDocument(
      "menu-button-document-aligned-5226",
      MenuButtonChainAligned
    );
    try {
      // The whole server-rendered chain is claimed: no key miss, no
      // unclaimed node, and every server element survives as itself.
      expect(warn).not.toHaveBeenCalled();
      const button = document.querySelector("button")!;
      expect(button).toBe(serverButton);
      for (const node of serverNodes) expect(node.isConnected).toBe(true);
      expect(document.querySelector("sm-navigation-rail")).toBeTruthy();
      expect(document.querySelector("md-icon")).toBeTruthy();

      // Interactive: a real click on the server-rendered button flips the
      // rail's expansion state through the hydrated reactive graph.
      expect(button.getAttribute("aria-checked")).toBe("false");
      button.click();
      flush();
      expect(button.getAttribute("aria-checked")).toBe("true");
      // A boolean-attribute binding: true is the attribute's presence.
      expect(document.querySelector(".rail")!.hasAttribute("data-expanded")).toBe(true);
      expect(document.body.textContent).toContain("menu-open-icon");
      // And back: the binding is live, not a one-shot replay.
      button.click();
      flush();
      expect(button.getAttribute("aria-checked")).toBe("false");
      expect(document.querySelector(".rail")!.hasAttribute("data-expanded")).toBe(false);
      expect(document.body.textContent).toContain("menu-icon");
    } finally {
      dispose();
      warn.mockRestore();
      cleanup();
    }
  });

  test.fails("gated (#5226): the server-rendered button is claimed and interactive", async () => {
    const { warn, serverNodes, serverButton, dispose } = await hydrateDocument(
      "menu-button-document-5226",
      MenuButtonChain
    );
    try {
      // The same assertions — they fail today: the three client-only ids
      // shift the client's keys past the server's (Hydration key miss /
      // unclaimed server nodes warnings fire), the server-rendered chain
      // stays inert, and the click does nothing. Flips when a fix lands.
      expect(warn).not.toHaveBeenCalled();
      const button = document.querySelector("button")!;
      expect(button).toBe(serverButton);
      for (const node of serverNodes) expect(node.isConnected).toBe(true);
      button.click();
      flush();
      expect(button.getAttribute("aria-checked")).toBe("true");
    } finally {
      dispose();
      warn.mockRestore();
      cleanup();
    }
  });
});
