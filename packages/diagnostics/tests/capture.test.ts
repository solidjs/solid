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

    expect(artifact.formatVersion).toBe(5);
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

// The server tables fold `OBSERVE.server.records` — a surface `solid-js`'s
// server entry installs. This suite runs against bare signals, where the
// slot is empty, so the channel is stood in for here by its contract
// (`subscribe(type, listener)`); the web server suite exercises the real one
// end to end (`diagnostics-server-scenario.spec.tsx`).
describe("captureArtifact — server tables", () => {
  type Listener = (event: unknown, live?: unknown) => void;
  function installRecords() {
    const listeners = new Map<string, Set<Listener>>();
    const records = {
      subscribe(type: string, listener: Listener) {
        let set = listeners.get(type);
        if (!set) listeners.set(type, (set = new Set()));
        set.add(listener);
        return () => {
          set!.delete(listener);
        };
      }
    };
    const server = OBSERVE!.server as { records?: unknown };
    server.records = records;
    return {
      emit(type: string, event: unknown) {
        for (const listener of listeners.get(type) ?? []) listener(event, {});
      },
      listening: (type: string) => listeners.get(type)?.size ?? 0,
      uninstall() {
        delete server.records;
      }
    };
  }

  it("is null without the server runtime's surface", async () => {
    const { artifact } = await captureArtifact(() => {}, { attribution: false });
    expect(artifact.server).toBeNull();
  });

  it("collects boundary and invocation records in settle order, copied", async () => {
    const channel = installRecords();
    try {
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
      const { artifact } = await captureArtifact(
        () => {
          channel.emit("invocation", invocation);
          channel.emit("boundary", boundary);
          channel.emit("frame", { id: "unknown-type" });
        },
        { scenario: "server", attribution: false }
      );
      expect(artifact.server).toEqual({ boundaries: [boundary], invocations: [invocation] });
      // A copy: the record object is shared with every listener.
      expect(artifact.server!.boundaries[0]).not.toBe(boundary);
      expect(artifact.server!.invocations[0]!.boundary).toBe(artifact.server!.boundaries[0]!.id);
      // The subscriptions end with the capture.
      expect(channel.listening("boundary")).toBe(0);
      expect(channel.listening("invocation")).toBe(0);

      const lines = artifactToJSONL(artifact)
        .trim()
        .split("\n")
        .map(line => JSON.parse(line));
      expect(lines[0]).toMatchObject({ type: "meta", boundaryCount: 1, invocationCount: 1 });
      expect(lines.slice(1)).toEqual([
        { type: "boundary", ...boundary },
        { type: "invocation", ...invocation }
      ]);
    } finally {
      channel.uninstall();
    }
  });

  it("reports null counts in the JSONL header without server tables", async () => {
    const { artifact } = await captureArtifact(() => {}, { attribution: false });
    const meta = JSON.parse(artifactToJSONL(artifact).split("\n")[0]!);
    expect(meta).toMatchObject({ boundaryCount: null, invocationCount: null });
  });
});
