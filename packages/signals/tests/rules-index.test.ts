import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Every rule ID a source comment cites (A<n>, V<n>, INV-<n>, RUL-<n>, R<n>,
// §<n>) must resolve to a definition in docs/ — see docs/RULES-INDEX.md and
// scripts/rules-index.mjs. IDs are never renumbered; a section that moves or
// a rule that retires keeps its ID as an anchor. This caught six dangling
// citations (§11b, §12–§12e, INV-8) whose definitions had left with the
// pre-absorb DESIGN-PATCH-CHANNEL.md.
describe("rules index", () => {
  it("every rule ID cited in src/ resolves to a documented definition", () => {
    const script = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../scripts/rules-index.mjs"
    );
    const out = execFileSync(process.execPath, [script, "--check"], { encoding: "utf8" });
    expect(out).toContain("every src/ citation resolves");
  });

  it("every live A-rule is cited by ID from at least one test", () => {
    const script = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../scripts/rules-index.mjs"
    );
    const out = execFileSync(process.execPath, [script, "--check"], { encoding: "utf8" });
    expect(out).toContain("every live A-rule is cited by a test");
  });

  it("docs/RULES-INDEX.md is current (regenerate with `node scripts/rules-index.mjs`)", () => {
    const script = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../scripts/rules-index.mjs"
    );
    const out = execFileSync(process.execPath, [script, "--check"], { encoding: "utf8" });
    expect(out).toContain("RULES-INDEX.md is current");
  });
});
