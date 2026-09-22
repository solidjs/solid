/** @vitest-environment node */
/**
 * `ssrScope` — the virtual id scope around a deferred child hole — under
 * TRANSPARENT owners.
 *
 * The scope is virtual: it swaps an owner's `id`/`_childCount` around the
 * evaluation instead of allocating a hole owner, and content created inside
 * reads its ids through `nextChildIdFor`, which walks UP past transparent
 * owners to the nearest id-bearing one. The owner the scope swaps must be
 * that same id-bearing owner; swapping whatever is current — a transparent
 * owner, which the walk skips — makes the reserved slot invisible, and the
 * hole's content takes fresh ids from the enclosing counter instead
 * (`_hk=3` where the client, and the prod inline `Comp(props)` output,
 * expect `_hk=10`).
 *
 * Two transparent owners sit between a component body and its id-bearing
 * ancestor: the labelled `<Name>` owner the observe/dev `createComponent`
 * runs a body under (every compiled component, since the compiler emits
 * `createComponent` for SSR under `sourceNames.components`), and the server-component
 * scope owner in every tier.
 */
import { describe, expect, test } from "vitest";
import {
  createComponent,
  createOwner,
  createRoot,
  getNextChildId,
  getOwner,
  runInServerComponentScope,
  runWithOwner,
  ssrScope
} from "../../src/server/index.js";

/** Ids the hole's content and its next sibling get, as `<Parent>{hole}<Sibling/>`. */
function idsUnder(body: (hole: () => unknown) => unknown) {
  const ids: string[] = [];
  createRoot(
    () => {
      body(() => {
        const inner = ssrScope(() => {
          ids.push(getNextChildId(getOwner()!));
          ids.push(getNextChildId(getOwner()!));
        });
        inner();
        ids.push(getNextChildId(getOwner()!));
      });
    },
    { id: "" }
  );
  return ids;
}

describe("ssrScope under transparent owners", () => {
  test("baseline: a direct owner reserves one slot and nests the hole's ids under it", () => {
    // Slot "0" is the scope; its content is "00", "01"; the sibling is "1".
    expect(idsUnder(hole => hole())).toEqual(["00", "01", "1"]);
  });

  test("a transparent owner between the hole and its id-bearing owner", () => {
    expect(idsUnder(hole => runWithOwner(createOwner({ transparent: true }), hole))).toEqual([
      "00",
      "01",
      "1"
    ]);
  });

  test("the server-component scope owner (every tier)", () => {
    expect(idsUnder(hole => runInServerComponentScope(hole))).toEqual(["00", "01", "1"]);
  });

  test("the labelled component owner (observe/dev createComponent)", () => {
    expect(
      idsUnder(hole =>
        createComponent(function Parent() {
          hole();
          return "";
        }, {})
      )
    ).toEqual(["00", "01", "1"]);
  });

  test("nested: a scope registered inside a scope, both through transparent owners", () => {
    const ids: string[] = [];
    createRoot(
      () => {
        runWithOwner(createOwner({ transparent: true }), () => {
          const outer = ssrScope(() => {
            runWithOwner(createOwner({ transparent: true }), () => {
              ids.push(getNextChildId(getOwner()!));
              const inner = ssrScope(() => {
                ids.push(getNextChildId(getOwner()!));
              });
              inner();
              ids.push(getNextChildId(getOwner()!));
            });
          });
          outer();
          ids.push(getNextChildId(getOwner()!));
        });
      },
      { id: "" }
    );
    // Outer scope "0": first child "00", inner scope "01" with content "010",
    // then "02"; the root continues at "1".
    expect(ids).toEqual(["00", "010", "02", "1"]);
  });
});
