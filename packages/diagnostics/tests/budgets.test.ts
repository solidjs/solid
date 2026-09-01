import { createEffect, createMemo, createRoot, createSignal, flush } from "@solidjs/signals";
import {
  assertBudget,
  assertBudgetFile,
  captureArtifact,
  DiagnosticsAssertionError,
  parseBudgetFile
} from "../src/index.js";
import type { DiagnosticsArtifact } from "../src/index.js";
import { deterministicAttribution } from "./helpers.js";

async function toggleScenario(scenario?: string): Promise<DiagnosticsArtifact> {
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
    {
      scenario,
      attribution: deterministicAttribution
    }
  );
  return artifact;
}

describe("assertBudget", () => {
  it("passes when every stated bound holds", async () => {
    const artifact = await toggleScenario();
    assertBudget(artifact, {
      maxWastedRuns: 0,
      scopes: { double: 2, "/^render$/": 2 }
    });
  });

  it("fails on a violated per-scope cap", async () => {
    const artifact = await toggleScenario();
    expect(() => assertBudget(artifact, { scopes: { double: 0 } })).toThrow(
      DiagnosticsAssertionError
    );
  });

  it("only enforces stated bounds", async () => {
    const artifact = await toggleScenario();
    // No bounds at all: only the implicit no-diagnostics gate applies.
    assertBudget(artifact, {});
  });
});

describe("budget files", () => {
  const file = parseBudgetFile(
    JSON.stringify({
      formatVersion: 1,
      scenarios: {
        toggle: { maxWastedRuns: 0, scopes: { "/double|render/": 2 } }
      }
    })
  );

  it("enforces the budget matching the artifact's scenario", async () => {
    const artifact = await toggleScenario("toggle");
    assertBudgetFile(artifact, file);
  });

  it("fails loudly for unbudgeted scenarios", async () => {
    const artifact = await toggleScenario("unknown-scenario");
    expect(() => assertBudgetFile(artifact, file)).toThrow(/No budget defined/);
  });

  it("fails for artifacts without a scenario name", async () => {
    const artifact = await toggleScenario();
    expect(() => assertBudgetFile(artifact, file)).toThrow(/scenario name/);
  });

  it("rejects malformed budget JSON", () => {
    expect(() => parseBudgetFile("not json")).toThrow(/not valid JSON/);
    expect(() => parseBudgetFile('{"formatVersion":2,"scenarios":{}}')).toThrow(/formatVersion/);
  });
});
