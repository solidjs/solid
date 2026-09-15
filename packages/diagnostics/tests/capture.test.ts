import {
  OBSERVE,
  createEffect,
  createMemo,
  createRoot,
  createSignal,
  flush
} from "@solidjs/signals";
import {
  artifactToJSONL,
  captureArtifact,
  DiagnosticsAssertionError,
  expectDiagnostic,
  expectNoDiagnostics,
  expectNoWaste,
  expectRerunBudget
} from "../src/index.js";
import { deterministicAttribution } from "./helpers.js";

describe("captureArtifact — diagnostics channel", () => {
  it("captures rule diagnostics emitted during the scenario", async () => {
    const { artifact } = await captureArtifact(
      () => {
        // An effect created outside any root can never be disposed —
        // deterministic NO_OWNER_EFFECT emission.
        createEffect(
          () => {},
          () => {}
        );
      },
      { scenario: "orphan effect", attribution: deterministicAttribution }
    );

    expect(artifact.formatVersion).toBe(6);
    expect(artifact.scenario).toBe("orphan effect");
    expectDiagnostic(artifact, "NO_OWNER_EFFECT");
    expect(() => expectNoDiagnostics(artifact)).toThrow(DiagnosticsAssertionError);
    expectNoDiagnostics(artifact, { allow: ["NO_OWNER_EFFECT"] });
  });

  it("captures nothing for a clean scenario", async () => {
    const { artifact } = await captureArtifact(
      () => {
        const [count, setCount] = createSignal(0);
        const dispose = createRoot(dispose => {
          const double = createMemo(() => count() * 2);
          createEffect(double, () => {});
          return dispose;
        });
        flush();
        setCount(1);
        flush();
        dispose();
      },
      { attribution: deterministicAttribution }
    );

    expectNoDiagnostics(artifact);
  });
});

describe("captureArtifact — attribution channel", () => {
  it("records re-runs with causes and enforces rerun budgets", async () => {
    const { artifact } = await captureArtifact(
      () => {
        const [count, setCount] = createSignal(0, { name: "count" });
        const dispose = createRoot(dispose => {
          const double = createMemo(() => count() * 2, { name: "double" });
          createEffect(double, () => {}, { name: "render" });
          return dispose;
        });
        flush();
        setCount(1);
        flush();
        dispose();
      },
      { attribution: deterministicAttribution }
    );

    expect(artifact.attribution).not.toBeNull();
    const reruns = artifact.attribution!.reruns;
    // One write should re-run exactly the memo and its one effect.
    const updates = reruns.filter(rerun => rerun.causes.length > 0);
    expect(updates.length).toBe(2);
    expect(updates.map(rerun => rerun.nodeName).sort()).toEqual(["double", "render"]);
    // Every update traces back to the "count" write.
    for (const rerun of updates) {
      const roots = new Set<string>();
      const walk = (causes: typeof rerun.causes) => {
        for (const cause of causes) {
          if (cause.causes?.length) walk(cause.causes);
          else roots.add(cause.name);
        }
      };
      walk(rerun.causes);
      expect([...roots]).toEqual(["count"]);
    }

    expectRerunBudget(artifact, 2, { scope: /double|render/ });
    expect(() => expectRerunBudget(artifact, 0, { scope: "double" })).toThrow(
      DiagnosticsAssertionError
    );
    expectNoWaste(artifact);
  });

  it("flags wasted re-runs (unchanged recomputes)", async () => {
    const { artifact } = await captureArtifact(
      () => {
        const [count, setCount] = createSignal(0, { name: "count" });
        const dispose = createRoot(dispose => {
          // Equality cutoff: parity is 0 for both writes below — downstream
          // recomputes are pure waste.
          const parity = createMemo(() => count() % 2, { name: "parity" });
          createEffect(parity, () => {});
          return dispose;
        });
        flush();
        setCount(2);
        flush();
        setCount(4);
        flush();
        dispose();
      },
      { attribution: deterministicAttribution }
    );

    expect(() => expectNoWaste(artifact)).toThrow(DiagnosticsAssertionError);
    expectNoWaste(artifact, { maxWastedRuns: 2 });
  });

  it("skips attribution when disabled", async () => {
    const { artifact } = await captureArtifact(() => {}, { attribution: false });
    expect(artifact.attribution).toBeNull();
    expect(() => expectRerunBudget(artifact, 0)).toThrow(DiagnosticsAssertionError);
  });
});

describe("artifact egress", () => {
  it("serializes to JSONL with a meta header and typed records", async () => {
    const { artifact } = await captureArtifact(
      () => {
        const [count, setCount] = createSignal(0, { name: "count" });
        const dispose = createRoot(dispose => {
          createEffect(count, () => {});
          return dispose;
        });
        flush();
        setCount(1);
        flush();
        dispose();
      },
      { scenario: "jsonl", attribution: deterministicAttribution }
    );

    const lines = artifactToJSONL(artifact).trim().split("\n");
    const meta = JSON.parse(lines[0]!);
    expect(meta.type).toBe("meta");
    expect(meta.scenario).toBe("jsonl");
    const types = lines.slice(1).map(line => JSON.parse(line).type);
    expect(types).toContain("costs");
    // Every line must round-trip as standalone JSON (no live node refs).
    for (const line of lines) expect(() => JSON.parse(line)).not.toThrow();
  });
});

// The records tables fold `OBSERVE.records` — the core's channel, which the
// runtimes (`solid-js`, `@solidjs/web`) emit onto. This suite runs against
// bare signals, where nothing emits, so records are put on the real channel
// by hand; the web suites exercise the real emitters end to end
// (`diagnostics-server-scenario.spec.tsx`, `client-records.spec.tsx`).
describe("captureArtifact — records tables", () => {
  const channel = OBSERVE!.records as unknown as {
    observed(type: string): boolean;
    emit(type: string, event: unknown, live: unknown): void;
  };

  it("is present, with empty tables, when nothing was recorded", async () => {
    const { artifact } = await captureArtifact(() => {}, { attribution: false });
    expect(artifact.records).toEqual({ boundary: [], invocation: [], frame: [], call: [] });
  });

  it("collects every record type in delivery order, copied, and ends its subscriptions", async () => {
    const boundary = {
      id: "0-0-1",
      at: 10,
      durationMs: 40,
      heldMs: 0,
      passes: 2,
      outcome: "settled",
      streamed: true,
      ownerPath: ["App", "Loading"]
    };
    const invocation = {
      id: "getUser",
      direct: true,
      at: 12,
      durationMs: 30,
      outcome: "ok",
      boundary: "0-0-1"
    };
    const produced = {
      side: "server",
      id: "getUser",
      version: 1,
      at: 8,
      durationMs: 60,
      shellMs: 12,
      outcome: "complete",
      chunks: 4,
      fragments: 1,
      slots: 0,
      regions: 0,
      errors: 0
    };
    const applied = { ...produced, side: "client", version: 4, address: "local-1", durationMs: 75 };
    const call = {
      id: "getUser",
      at: 5,
      durationMs: 90,
      method: "POST",
      outcome: "ok",
      status: 200
    };
    expect(channel.observed("boundary")).toBe(false);
    const { artifact } = await captureArtifact(
      () => {
        expect(channel.observed("boundary")).toBe(true);
        channel.emit("invocation", invocation, {});
        channel.emit("boundary", boundary, {});
        channel.emit("frame", produced, {});
        channel.emit("call", call, {});
        channel.emit("frame", applied, {});
        channel.emit("hydration", { id: "unknown-type" }, {});
      },
      { scenario: "records", attribution: false }
    );
    expect(artifact.records).toEqual({
      boundary: [boundary],
      invocation: [invocation],
      frame: [produced, applied],
      call: [call]
    });
    // A copy: the record object is shared with every listener.
    expect(artifact.records.boundary[0]).not.toBe(boundary);
    expect(artifact.records.invocation[0]!.boundary).toBe(artifact.records.boundary[0]!.id);
    // The subscriptions end with the capture.
    for (const type of ["boundary", "invocation", "frame", "call"]) {
      expect(channel.observed(type), type).toBe(false);
    }

    const lines = artifactToJSONL(artifact)
      .trim()
      .split("\n")
      .map(line => JSON.parse(line));
    expect(lines[0]).toMatchObject({
      type: "meta",
      recordCounts: { boundary: 1, invocation: 1, frame: 2, call: 1 }
    });
    expect(lines.slice(1)).toEqual([
      { type: "boundary", ...boundary },
      { type: "invocation", ...invocation },
      { type: "frame", ...produced },
      { type: "frame", ...applied },
      { type: "call", ...call }
    ]);
  });

  it("reports zero counts in the JSONL header when nothing was recorded", async () => {
    const { artifact } = await captureArtifact(() => {}, { attribution: false });
    const meta = JSON.parse(artifactToJSONL(artifact).split("\n")[0]!);
    expect(meta.recordCounts).toEqual({ boundary: 0, invocation: 0, frame: 0, call: 0 });
  });
});
