/**
 * solidjs/solid#4035 — `createStore` records the owner in scope so its
 * property nodes carry an owner path; `createProjection` did not, so a
 * projection's nodes had none: attribution could not place them under the
 * component that made them, and the graph walk could not tell whose they
 * were. A projection now records it as a store does.
 */
import { afterEach, describe, expect, it } from "vitest";
import { attribution } from "../src/attribution.js";
import {
  createMemo,
  createProjection,
  createRoot,
  createStore,
  flush,
  getOwner
} from "../src/index.js";
import { ownerPath } from "../src/core/dev.js";

afterEach(() => {
  attribution.disable();
  flush();
});

const nameOwner = (name: string) => ((getOwner() as any)._name = name);

/** The property node `read` subscribes to, found through its reader's deps. */
function propertyNode(read: () => unknown): any {
  let reader: any;
  createMemo(() => {
    reader = getOwner();
    return read();
  })();
  return reader._deps._dep;
}

describe("a projection's property nodes carry the owner it was created under (#4035)", () => {
  it("as a store's do", () => {
    attribution.enable({ log: false });
    let storeNode: any;
    let projectionNode: any;
    const dispose = createRoot(dispose => {
      nameOwner("<Cache>");
      const [store] = createStore({ value: 1 });
      const projection = createProjection<{ value: number }>(
        draft => {
          draft.value = 2;
        },
        { value: 0 }
      );
      storeNode = propertyNode(() => store.value);
      projectionNode = propertyNode(() => projection.value);
      return dispose;
    });
    flush();
    expect(ownerPath(storeNode)).toEqual(["<Cache>"]);
    expect(ownerPath(projectionNode)).toEqual(["<Cache>"]);
    dispose();
  });
});
