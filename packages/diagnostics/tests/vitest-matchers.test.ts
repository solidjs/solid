import { createEffect, createRoot, createSignal, flush } from "@solidjs/signals";
import { captureArtifact } from "../src/index.js";
import "../src/vitest.js";
import { deterministicAttribution } from "./helpers.js";

describe("vitest matchers", () => {
  it("supports positive and negated forms", async () => {
    const { artifact: dirty } = await captureArtifact(
      () => {
        createEffect(
          () => {},
          () => {}
        );
      },
      { attribution: deterministicAttribution }
    );
    expect(dirty).toHaveDiagnostic("NO_OWNER_EFFECT");
    expect(dirty).not.toHaveNoDiagnostics();
    expect(dirty).toHaveNoDiagnostics({ allow: ["NO_OWNER_EFFECT"] });

    const { artifact: clean } = await captureArtifact(
      () => {
        const [count, setCount] = createSignal(0, { name: "count" });
        const dispose = createRoot(dispose => {
          createEffect(count, () => {}, { name: "render" });
          return dispose;
        });
        flush();
        setCount(1);
        flush();
        dispose();
      },
      { attribution: deterministicAttribution }
    );
    expect(clean).toHaveNoDiagnostics();
    expect(clean).toHaveNoWaste();
    expect(clean).toStayWithinRerunBudget(1, { scope: "render" });
    expect(clean).not.toStayWithinRerunBudget(0, { scope: "render" });
    expect(clean).toStayWithinBudget({ maxWastedRuns: 0, scopes: { render: 1 } });
  });

  it("reports evidence in failure messages", async () => {
    const { artifact } = await captureArtifact(
      () => {
        createEffect(
          () => {},
          () => {}
        );
      },
      { attribution: deterministicAttribution }
    );
    expect(() => expect(artifact).toHaveNoDiagnostics()).toThrow(/NO_OWNER_EFFECT/);
  });
});
