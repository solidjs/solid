/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * #2917 follow-up: per-root registry/gather isolation.
 *
 * Each hydrate() call installs sharedConfig.registry and sharedConfig.gather
 * globally. When root A still has a pending streamed <Loading> boundary and
 * root B starts (and finishes) hydrating, B's registry/gather replace A's.
 * A's late boundary resume then gathered against B's container and claimed
 * from B's registry: the server-streamed fragment was never claimed, the
 * boundary's reactive holes bound to orphaned fresh client nodes, and
 * post-hydration updates went nowhere visible.
 *
 * The fix captures the current root's { registry, gather } pair at boundary
 * registration time, keyed by the full boundary id (no prefix parsing — root
 * id and counter path have no delimiter), and the resume path swaps the
 * captured pair in for its synchronous window.
 *
 * The streamed chunks in multi-root-registry.chunks.ts were captured from
 * renderToStream({ renderId: "a" | "b" }) rendering exactly the component in
 * makeApp() below (ssr generate), with the data promise resolved after the
 * shell flushed so each root streams its content fragment late.
 */
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { createMemo, createSignal, flush, Loading } from "solid-js";
import { hydrate } from "@solidjs/web";
import { A_SHELL, A_REST, B_SHELL, B_REST } from "./multi-root-registry.chunks.js";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// Split a chunk into markup and inline scripts, apply the markup, then eval
// the scripts — mirroring what a streaming browser parse does.
function applyChunk(container: HTMLDivElement, chunk: string, first: boolean) {
  const scriptRe = /<script(?:[^>]*)>([\s\S]*?)<\/script>/g;
  const scripts = [...chunk.matchAll(scriptRe)].map(m => m[1]);
  const stripped = chunk.replace(scriptRe, "");
  if (first) container.innerHTML = stripped;
  else container.insertAdjacentHTML("beforeend", stripped);
  for (const s of scripts) (0, eval)(s);
}

function makeApp(label: string) {
  const [text, setText] = createSignal("tick0");
  function App() {
    const data = createMemo(async () => {
      await sleep(5);
      return "content " + label;
    });
    return (
      <Loading fallback={<div>loading {label}</div>}>
        <div>
          {data()}
          <span>{text()}</span>
        </div>
      </Loading>
    );
  }
  return { App, setText };
}

describe("multi-root hydration — per-root registry/gather (#2917)", () => {
  let disposers: (() => void)[] = [];

  beforeEach(() => {
    (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: {}, fe() {} };
  });

  afterEach(async () => {
    for (const d of disposers) d();
    disposers = [];
    await sleep(10);
  });

  test("root A's late resume claims against A's registry after root B hydrated", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const containerA = document.createElement("div");
    const containerB = document.createElement("div");
    document.body.appendChild(containerA);
    document.body.appendChild(containerB);

    const A = makeApp("A");
    const B = makeApp("B");

    // Root A: shell only — its content fragment is still streaming.
    applyChunk(containerA, A_SHELL, true);
    disposers.push(hydrate(() => <A.App />, containerA, { renderId: "a" }));
    flush();
    await sleep(10);
    flush();
    expect(containerA.textContent).toContain("loading A");

    // Root B: starts while A is pending and completes fully. Its hydrate()
    // replaces the global registry/gather.
    applyChunk(containerB, B_SHELL, true);
    disposers.push(hydrate(() => <B.App />, containerB, { renderId: "b" }));
    flush();
    applyChunk(containerB, B_REST, false);
    await sleep(20);
    flush();
    expect(containerB.textContent).toBe("content Btick0");

    // A's fragment finally lands; the resume must gather from A's container
    // and claim from A's registry, not B's.
    applyChunk(containerA, A_REST, false);
    await sleep(20);
    flush();

    expect(containerA.textContent).toBe("content Atick0");
    // Exactly the server-streamed div, claimed — no duplicate client DOM.
    expect(containerA.querySelectorAll("div").length).toBe(1);

    // The reactive hole must be bound to the live claimed span: pre-fix the
    // claim missed (B's registry), the effect bound to an orphaned fresh
    // node, and this update was invisible.
    A.setText("tick1");
    flush();
    expect(containerA.textContent).toBe("content Atick1");

    // Root B's binding must be unaffected.
    B.setText("tock1");
    flush();
    expect(containerB.textContent).toBe("content Btock1");

    // Let hydration fully drain (verifyHydration runs on a timeout).
    await sleep(20);
    flush();
    const orphanWarns = warn.mock.calls.filter(
      (c: unknown[]) => typeof c[0] === "string" && c[0].includes("unclaimed server-rendered node")
    );
    expect(orphanWarns).toHaveLength(0);

    warn.mockRestore();
    containerA.remove();
    containerB.remove();
  });
});
