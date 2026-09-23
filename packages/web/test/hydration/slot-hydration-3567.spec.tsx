/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * solidjs/solid#3567: JSX passed through a prop other than `children` (a
 * layout's `header`, an object of slots, a context getter, a render prop)
 * hydrated with permuted keys whenever an id-allocating hole followed it in
 * the same template. The server reserves a scoped hole's slot while the
 * `ssr()` arguments are evaluated and resolves unscoped thunks later, inside
 * the walk; the client allocates in statement order. Both compilers treated
 * only `props.children` as able to build hydratable content, so the
 * `{props.header}` hole was unscoped: its `<button>` took the id the client
 * expected the children scope to hold, and vice versa. The server elements
 * stayed unclaimed, the client built detached copies, and the click handler
 * was bound to a copy the user could not see.
 *
 * Replays the renderToString artifacts test/server/slot-hydration-3567.spec.tsx
 * writes and asserts, for every scenario:
 *
 *  1. no console.warn during hydration — key misses and unclaimed-node reports
 *     are failures, not noise;
 *  2. every element the server minted a `_hk` for is still connected inside the
 *     container (claimed, not replaced by a detached copy);
 *  3. every node in the container after hydration is one the server rendered;
 *  4. textContent matches, and a click on the SERVER-rendered `#hdr` button
 *     reaches the handler (liveness — the issue's user-visible symptom).
 *
 *  5. no `UNSCOPED_HOLE_ALLOCATED_IDS` on `OBSERVE.diagnostics` — the scoped,
 *     call, component-accessor, `children()` and `<For>` shapes are silent.
 *
 * A scenario with `knownGap` is a shape the compiler leaves unscoped BY
 * RULING (TS-unreachable; not worth a production cost). Its test asserts the
 * opposite of 2/3 — the keys still permute — so a change is noticed, and
 * that the dev diagnostic in `scenario.diagnostic` fires during hydration
 * with the same code the server raised for the same render.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { flush, OBSERVE } from "solid-js";
import { hydrate } from "@solidjs/web";
import { scenarios, type Scenario } from "../harness/slot-hydration-3567.jsx";

const artifactsDir = resolve(dirname(fileURLToPath(import.meta.url)), "../harness/__artifacts__");
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function loadArtifact(name: string): { html: string; keys: string[] } {
  const file = resolve(artifactsDir, `slot-hydration-3567-${name}.json`);
  if (!existsSync(file)) {
    throw new Error(
      `Missing artifact "${name}". Run the server spec first: ` +
        `vitest run --config vite.config.server.mjs test/server/slot-hydration-3567.spec.tsx`
    );
  }
  return JSON.parse(readFileSync(file, "utf-8"));
}

function allNodes(root: Node): Node[] {
  const out: Node[] = [];
  const walk = (n: Node) => {
    for (let c = n.firstChild; c; c = c.nextSibling) {
      out.push(c);
      walk(c);
    }
  };
  walk(root);
  return out;
}

async function run(scenario: Scenario) {
  const { html } = loadArtifact(scenario.name);
  const container = document.createElement("div");
  document.body.appendChild(container);
  (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: {}, fe() {} };
  const warnings: string[] = [];
  const warn = vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
    warnings.push(args.map(String).join(" "));
  });
  const capture = OBSERVE!.diagnostics.capture();
  // A boundary whose fallback cannot see the error: dev logs the caught error.
  const error = scenario.logsCaughtError
    ? vi.spyOn(console, "error").mockImplementation(() => {})
    : undefined;
  let dispose: (() => void) | undefined;
  try {
    // Markup first, then the inline scripts — what a browser parse does.
    const scriptRe = /<script(?:[^>]*)>([\s\S]*?)<\/script>/g;
    const scripts = [...html.matchAll(scriptRe)].map(m => m[1]);
    container.innerHTML = html.replace(scriptRe, "");
    for (const s of scripts) (0, eval)(s);

    const serverKeyed = [...container.querySelectorAll("[_hk]")];
    const serverNodes = new Set(allNodes(container));
    const serverButton = container.querySelector<HTMLButtonElement>("#hdr");

    dispose = hydrate(() => <scenario.App />, container);
    flush();
    // hydration completes on a microtask; updates before that are no-ops
    await sleep(10);
    flush();

    const holeEvents = capture.events.filter(e => e.code === "UNSCOPED_HOLE_ALLOCATED_IDS");
    if (scenario.knownGap) {
      // The ruling's two halves: the diagnostic fired for the hole, and the
      // keys still permute. A future change that aligns the shape fails the
      // second assertion — flip this scenario to a regular one then.
      expect(holeEvents).toHaveLength(1);
      expect(holeEvents[0].kind).toBe("render");
      expect(holeEvents[0].severity).toBe("warn");
      expect(holeEvents[0].data).toMatchObject({ name: "renderHead" });
      expect(holeEvents[0].data!.before).not.toBe(holeEvents[0].data!.after);
      expect(holeEvents[0].message).toContain("{renderHead()}");
      expect(
        warnings.filter(w => w.includes("[UNSCOPED_HOLE_ALLOCATED_IDS]")),
        warnings.join("\n")
      ).toHaveLength(1);
      expect(container.textContent).toBe(scenario.expectedText);
      // The permutation's symptoms: the client's keys miss the server's
      // elements (detached copies are built instead), and the handler is
      // bound to a copy, so the server-rendered button is dead.
      const closed = `${scenario.name} hydrated aligned — the ruling's gap closed; flip the scenario`;
      expect(
        warnings.filter(w => w.startsWith("Hydration key miss")).length,
        closed
      ).toBeGreaterThan(0);
      expect(serverButton, "the pinned shape renders the #hdr button").not.toBeNull();
      serverButton!.click();
      flush();
      expect(container.textContent, closed).toBe(scenario.expectedText);
      return;
    }

    expect(holeEvents).toEqual([]);
    expect(warnings, warnings.join("\n")).toEqual([]);
    if (error) expect(error).toHaveBeenCalled();
    expect(container.textContent).toBe(scenario.expectedText);
    for (const el of serverKeyed) {
      expect(
        el.isConnected && container.contains(el),
        `server <${el.localName} _hk=${el.getAttribute("_hk")}> left unclaimed`
      ).toBe(true);
    }
    for (const node of allNodes(container)) {
      const what =
        node.nodeType === 3 ? `text "${node.nodeValue}"` : `<${(node as Element).localName}>`;
      expect(serverNodes.has(node), `client-created ${what} after hydration`).toBe(true);
    }

    if (serverButton) {
      serverButton.click();
      flush();
    }
    expect(container.textContent).toBe(scenario.expectedTextAfterClick);
    expect(warnings, warnings.join("\n")).toEqual([]);
  } finally {
    capture.stop();
    warn.mockRestore();
    error?.mockRestore();
    dispose?.();
    // let queued hydration-event microtasks drain before tearing down _$HY
    await sleep(0);
    container.remove();
  }
}

describe("JSX through a non-children prop (#3567) — client hydrate", () => {
  beforeEach(async () => {
    await sleep(0);
  });
  afterEach(async () => {
    await sleep(0);
  });

  for (const scenario of scenarios) {
    const title = scenario.name + (scenario.knownGap ? ` (known gap: ${scenario.knownGap})` : "");
    test(title, () => run(scenario));
  }
});
