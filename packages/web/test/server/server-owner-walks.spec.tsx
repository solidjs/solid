/**
 * The core's owner walks over server owners, per tier, against the BUILT
 * artifacts (server-owner-walks.fixture.mjs in a child Node under Node's
 * real resolver). The suite aliases to source, where nothing is mangled, so
 * only a built run can show that `ownerPath` and `OBSERVE.exclude` see
 * solid-js's SSR owners through signals' property mangling — the `_parent`
 * + `_name` reservation. Requires a prior `pnpm build`.
 */
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

const FIXTURE = resolve(import.meta.dirname, "server-owner-walks.fixture.mjs");

interface Scenario {
  html: string;
  findings: Array<{ code: string; ownerPath?: string[] }>;
}
interface Results {
  observe: boolean;
  plain: Scenario;
  excluded: Scenario;
}

function run(conditions: string[]): Results {
  const stdout = execFileSync(
    process.execPath,
    [...conditions.map(c => `--conditions=${c}`), FIXTURE],
    { cwd: process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
  );
  return JSON.parse(stdout);
}

describe.each([
  ["observe", ["observe"]],
  ["development", ["development"]]
])("%s artifacts", (_name, conditions) => {
  test("a server finding locates itself through the core's walk, component labels included", () => {
    const { observe, plain } = run(conditions);
    expect(observe).toBe(true);
    expect(plain.html).toMatch(/<p>(boom|Internal Server Error)<\/p>/);
    const contained = plain.findings.filter(f => f.code === "SSR_RENDER_ERROR_CONTAINED");
    expect(contained).toHaveLength(1);
    expect(contained[0].ownerPath).toEqual(["<App>", "<Errored>"]);
  });

  test("OBSERVE.exclude on a server owner silences findings under it", () => {
    const { excluded } = run(conditions);
    // The boundary still renders its fallback; the observer just hears nothing.
    expect(excluded.html).toMatch(/<p>(boom|Internal Server Error)<\/p>/);
    expect(excluded.findings).toEqual([]);
  });
});

test("the production artifacts have no channel to walk for", () => {
  const { observe, plain, excluded } = run([]);
  expect(observe).toBe(false);
  expect(plain.findings).toEqual([]);
  expect(excluded.html).toContain("<p>Internal Server Error</p>");
});
