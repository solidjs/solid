// Its own file: enableHydration() below rewires the dist modules for the rest of the file.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
// Relative imports on purpose: they bypass the `solid-js` → source alias.
// @ts-ignore — dist files have no adjacent type declarations.
import * as prod from "../dist/solid.js";
// @ts-ignore
import * as prodStore from "../dist/solid.store.js";
// @ts-ignore
import * as observe from "../dist/solid.observe.js";
// @ts-ignore
import * as observeStore from "../dist/solid.observe.store.js";

const read = (f: string) => readFileSync(resolve(__dirname, "../dist", f), "utf8");

describe("solid-js store file", () => {
  test.each([
    ["solid.js", prod, prodStore],
    ["solid.observe.js", observe, observeStore]
  ])("%s re-exports the store facades from its sibling store file", (file, main, store) => {
    const storeFile = file.replace(/\.js$/, ".store.js");
    expect(read(storeFile)).toContain(`from './${file}'`);
    expect(read(storeFile)).not.toContain("expected a component function");
    for (const name of ["createStore", "createOptimisticStore", "createProjection"])
      expect(main[name]).toBe(store[name]);
    expect(main._hydrateStoreLike).toBeUndefined();
    main.enableHydration();
    expect(typeof main._hydrateStoreLike).toBe("function");
    const [s, set] = main.createStore({ n: 1 });
    set((d: { n: number }) => {
      d.n = 2;
    });
    main.flush();
    expect(s.n).toBe(2);
  });
});
