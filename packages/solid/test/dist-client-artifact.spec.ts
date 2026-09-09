/**
 * Direct coverage of the built client artifacts across the three tiers —
 * dist/solid.js (prod), dist/solid.observe.js (`observe` condition under
 * `browser`) and dist/solid.dev.js (`development`). The rest of the suite
 * aliases `solid-js` to source, where both build literals are truthy, so it
 * cannot see what each tier keeps. Two observables per artifact:
 *
 *  - the `OBSERVE`/`DEV` exports: prod (undefined, undefined), observe
 *    (signals' object, undefined), dev (both signals' objects);
 *  - the component label: observe and dev run components in a transparent
 *    root carrying `_name`, so a finding emitted from a component body
 *    locates itself as `["<App>"]`; prod has no such root and no path.
 *
 * Requires a prior `pnpm build`. Each artifact externalizes @solidjs/signals,
 * which resolves here to the dev build — the same instance for all three —
 * so `OBSERVE.diagnostics` is one channel regardless of which artifact
 * emitted.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { getOwner, OBSERVE as signalsOBSERVE, DEV as signalsDEV } from "@solidjs/signals";
// Relative imports on purpose: they bypass the `solid-js` → source alias.
// @ts-ignore — dist files have no adjacent type declarations.
import * as prod from "../dist/solid.js";
// @ts-ignore
import * as observe from "../dist/solid.observe.js";
// @ts-ignore
import * as dev from "../dist/solid.dev.js";

type Artifact = {
  OBSERVE: unknown;
  DEV: unknown;
  createComponent: (Comp: (props: any) => unknown, props: any) => unknown;
  createRoot: <T>(fn: () => T) => T;
};

/** Emits one finding from inside a component rendered by `artifact` and returns its ownerPath. */
function pathFromComponent(artifact: Artifact): string[] | undefined {
  const capture = signalsOBSERVE!.diagnostics.capture();
  function App() {
    signalsOBSERVE!.diagnostics.emit(
      { code: "INVARIANT_VIOLATION", kind: "error", severity: "error", message: "probe" },
      getOwner()
    );
    return null;
  }
  artifact.createRoot(() => artifact.createComponent(App, {}));
  const [event] = capture.stop();
  return event.ownerPath;
}

describe("solid-js client artifacts", () => {
  test("dist/solid.js (prod): no OBSERVE, no DEV, no component label", () => {
    expect(prod.OBSERVE).toBeUndefined();
    expect(prod.DEV).toBeUndefined();
    expect(pathFromComponent(prod as Artifact)).toBeUndefined();
  });

  test("dist/solid.observe.js: signals' OBSERVE, no DEV, components labelled", () => {
    expect(observe.OBSERVE).toBe(signalsOBSERVE);
    expect(observe.DEV).toBeUndefined();
    expect(pathFromComponent(observe as Artifact)).toEqual(["<App>"]);
  });

  test("dist/solid.dev.js: both objects, components labelled", () => {
    expect(dev.OBSERVE).toBe(signalsOBSERVE);
    expect(dev.DEV).toBe(signalsDEV);
    expect(pathFromComponent(dev as Artifact)).toEqual(["<App>"]);
  });

  test("the observe artifact carries no dev-only check", () => {
    // The non-function component check is dev-tier; a string scan is valid
    // here because the message text only exists inside the `IS_DEV` branch.
    const read = (f: string) => readFileSync(resolve(__dirname, "../dist", f), "utf8");
    expect(read("solid.dev.js")).toContain("expected a component function");
    expect(read("solid.observe.js")).not.toContain("expected a component function");
    expect(read("solid.js")).not.toContain("expected a component function");
    // …while the label write is observe-tier: present in observe and dev, absent in prod.
    expect(read("solid.observe.js")).toContain("._name = ");
    expect(read("solid.js")).not.toContain("._name = ");
  });

  test("the three artifacts export the same surface", () => {
    expect(Object.keys(observe).sort()).toEqual(Object.keys(prod).sort());
    expect(Object.keys(dev).sort()).toEqual(Object.keys(prod).sort());
  });
});
