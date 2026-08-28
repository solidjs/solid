/**
 * Renderer-surface contract harness (re-audit 7). INVARIANT: every name the
 * compilers can emit as a runtime import must exist on the documented
 * surface of the module it imports from — for dom output that is
 * `@solidjs/web`'s real export list; for universal output it is the
 * `Renderer` interface `createRenderer()` implements. A compiler feature
 * that adds an import (the patch flip did) must extend the runtime surface
 * AND its documented type in the same change, or every custom renderer
 * following the docs breaks at module linking.
 */
const fs = require("fs");
const path = require("path");
const { transform } = require("../index");

// Corpus chosen to pull EVERY emission family: patch-eligible member-read
// bindings (patchDriver under default-on), a keyed store list row
// (rowProof), classic dynamic bindings, events (delegated + bound),
// refs, spreads, style/class helpers, fragments, and insert holes.
const CORPUS = `
import { For, Show } from "solid-js";
const a = <div class={state.cls} style={state.style} title={state.item.title} textContent={state.item.label} />;
const b = <ul>
  <For each={state.rows}>{row => <li data-id={row.id} textContent={row.label} />}</For>
</ul>;
const c = <button onClick={() => state.go()} oncapture:focus={e => e} ref={el => el} {...state.rest}>
  <Show when={state.on}>{v => <span>{v()}</span>}</Show>
  {state.hole}
</button>;
const d = <>
  <input value={state.value} onInput={e => e} />
  <svg><path d={state.d} /></svg>
</>;
`;

function importsFrom(code, moduleName) {
  const names = new Set();
  const re = new RegExp(`import\\s*\\{([^}]*)\\}\\s*from\\s*"${moduleName}"`, "g");
  let m;
  while ((m = re.exec(code)) !== null) {
    for (const piece of m[1].split(",")) {
      const name = piece
        .trim()
        .split(/\s+as\s+/)[0]
        .trim();
      if (name) names.add(name);
    }
  }
  return [...names];
}

async function webExportSurface() {
  const web = await import(path.resolve(__dirname, "../../web/dist/web.js"));
  return new Set(Object.keys(web));
}

function rendererInterfaceKeys() {
  const src = fs.readFileSync(path.resolve(__dirname, "../../universal/src/universal.ts"), "utf8");
  const start = src.indexOf("export interface Renderer<");
  const body = src.slice(start, src.indexOf("\n}", start));
  const keys = new Set();
  for (const line of body.split("\n")) {
    const m = /^\s{2}(\w+)[<(?:]/.exec(line);
    if (m) keys.add(m[1]);
  }
  return keys;
}

async function universalRuntimeSurface() {
  const { createRenderer } = await import(
    path.resolve(__dirname, "../../universal/dist/universal.js")
  );
  const stub = () => {};
  return Object.keys(
    createRenderer({
      createElement: stub,
      createTextNode: stub,
      replaceText: stub,
      isTextNode: stub,
      setProperty: stub,
      insertNode: stub,
      removeNode: stub,
      getParentNode: stub,
      getFirstChild: stub,
      getNextSibling: stub
    })
  );
}

describe("compiled imports ⊆ documented runtime surface", () => {
  it("dom output (default options) links against @solidjs/web", async () => {
    const surface = await webExportSurface();
    const out = transform(CORPUS, { filename: "c.jsx", moduleName: "@solidjs/web" });
    const names = importsFrom(out.code, "@solidjs/web");
    // The corpus must actually exercise the patch tier, or this test
    // silently stops guarding the flip.
    expect(names).toContain("patchDriver");
    const missing = names.filter(n => !surface.has(n));
    expect(missing).toEqual([]);
  });

  it("universal output links against the documented Renderer interface", () => {
    const iface = rendererInterfaceKeys();
    const out = transform(CORPUS, {
      filename: "c.jsx",
      generate: "universal",
      moduleName: "r-custom"
    });
    const names = importsFrom(out.code, "r-custom");
    expect(names.length).toBeGreaterThan(0);
    const missing = names.filter(n => !iface.has(n));
    expect(missing).toEqual([]);
  });

  it("the Renderer interface documents the FULL createRenderer surface (type ⊇ runtime)", async () => {
    const iface = rendererInterfaceKeys();
    const runtime = await universalRuntimeSurface();
    const undocumented = runtime.filter(n => !iface.has(n));
    // A member createRenderer ships but the type omits is invisible to
    // every custom renderer following the docs — patchDriver's exact hole.
    expect(undocumented).toEqual([]);
  });
});
