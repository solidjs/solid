import { createEffect, createMemo, createRoot, createSignal, flush } from "@solidjs/signals";
import {
  artifactToJSONL,
  captureArtifact,
  DiagnosticsAssertionError,
  expectDiagnostic,
  expectNoDiagnostics,
  expectNoWaste,
  expectRerunBudget
} from "../src/index.js";

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
      { scenario: "orphan effect" }
    );

    expect(artifact.formatVersion).toBe(1);
    expect(artifact.scenario).toBe("orphan effect");
    expectDiagnostic(artifact, "NO_OWNER_EFFECT");
    expect(() => expectNoDiagnostics(artifact)).toThrow(DiagnosticsAssertionError);
    expectNoDiagnostics(artifact, { allow: ["NO_OWNER_EFFECT"] });
  });

  it("captures nothing for a clean scenario", async () => {
    const { artifact } = await captureArtifact(() => {
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
    });

    expectNoDiagnostics(artifact);
  });
});

describe("captureArtifact — attribution channel", () => {
  it("records re-runs with causes and enforces rerun budgets", async () => {
    const { artifact } = await captureArtifact(() => {
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
    });

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
    const { artifact } = await captureArtifact(() => {
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
    });

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
      { scenario: "jsonl" }
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
