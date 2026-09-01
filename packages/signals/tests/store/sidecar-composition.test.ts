/**
 * Sidecar composition (discussion #3085): the recommended shape for a
 * stateful component library layering its own writable state over a
 * user-owned store. Membership and fields render from the USER's store
 * directly (optimistic overlays are read-time overrides, so direct readers
 * see them mid-action); library ephemera live in a library-owned store keyed
 * by row id and are joined at read time. Ownership stays disjoint — the
 * library never writes into the user's store — so library writes never enter
 * an optimistic overlay and nothing needs syncing or store-kind detection.
 *
 * This is publicly recommended composition advice; if it breaks, the
 * recommendation breaks with it.
 */
import {
  action,
  createOptimisticStore,
  createRenderEffect,
  createRoot,
  createStore,
  flush
} from "../../src/index.js";

it("sidecar: optimistic membership renders; keyed ephemera persist", async () => {
  let resolveServer!: () => void;
  const serverDone = new Promise<void>(r => (resolveServer = r));

  let users: any, setUsers: any, lib: any, setLib: any;
  let rendered: any;
  createRoot(() => {
    // User-owned store (arrives as a prop).
    [users, setUsers] = createOptimisticStore([{ id: 1, x: 10 }]);
    // Library-owned ephemera, keyed by row id — no membership mirror.
    [lib, setLib] = createStore({} as Record<string, { selected?: boolean; dragX?: number }>);
    // The library's render path: user store drives membership AND fields,
    // ephemera joined per row by key.
    createRenderEffect(
      () => users.map((u: any) => [u.id, u.x, lib[u.id]?.selected ?? false]),
      (v: any) => {
        rendered = v;
      }
    );
  });
  flush();
  expect(rendered).toEqual([[1, 10, false]]);

  // Library ephemera write (outside any action) — persists, renders.
  setLib((d: any) => {
    d[1] = { selected: true };
  });
  flush();
  expect(rendered).toEqual([[1, 10, true]]);

  // User's optimistic MEMBERSHIP + field edit mid-action.
  const act = action(function* () {
    setUsers((d: any) => {
      d[0].x = 99;
      d.push({ id: 2, x: 20 });
    });
    yield serverDone;
  });
  const p = act();
  flush();
  // The overlay renders through the library immediately: new node visible,
  // field edit visible, ephemera intact.
  expect(rendered).toEqual([
    [1, 99, true],
    [2, 20, false]
  ]);

  // Library write DURING the in-flight action (e.g. user selects the
  // optimistic node) — plain write, persists.
  setLib((d: any) => {
    d[2] = { selected: true };
  });
  flush();
  expect(rendered).toEqual([
    [1, 99, true],
    [2, 20, true]
  ]);

  resolveServer();
  await p;
  flush();
  // No refetch in this test: overlay reverts. Ephemera survive untouched;
  // the stale id-2 entry is harmless (sparse map).
  expect(rendered).toEqual([[1, 10, true]]);
  expect(lib[2]?.selected).toBe(true);
});
