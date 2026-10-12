import { describe, expect, it } from "vitest";
import {
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  createStore,
  flush
} from "../src/index.js";

type U = { id: number; name: string };
function run(shared: boolean) {
  const u1 = { id: 1, name: "a" },
    u2 = { id: 2, name: "b" };
  const [server, setServer] = createSignal<{ users: U[]; selectedUser: U | null }>({
    users: [u1, u2],
    selectedUser: shared ? u2 : { id: 2, name: "b" }
  });
  let s!: { users: U[]; selectedUser: U | null };
  const seen: string[] = [];
  createRoot(() => {
    [s] = createStore(() => server(), { users: [], selectedUser: null });
    createRenderEffect(
      createMemo(() => `${s.selectedUser?.id}:${s.selectedUser?.name}`),
      v => void seen.push(v)
    );
    createRenderEffect(
      createMemo(() => `${s.users[1].id}:${s.users[1].name}`),
      v => void seen.push("row " + v)
    );
  });
  flush();
  const selBefore = s.selectedUser,
    rowBefore = s.users[1];
  expect(selBefore === rowBefore).toBe(shared);
  // selection changes to a different entity; the list is unchanged
  const u5 = { id: 5, name: "e" };
  setServer({ users: [u1, u2], selectedUser: u5 });
  flush();
  return { s, seen, selBefore, rowBefore };
}

describe("users + selectedUser: the property changes to a different entity", () => {
  for (const shared of [false, true])
    it(`selectedUser ${shared ? "shares" : "copies"} the row object`, () => {
      const { s, seen, selBefore, rowBefore } = run(shared);
      expect(s.selectedUser!.id).toBe(5);
      expect(s.selectedUser!.name).toBe("e");
      expect(s.users[1].id).toBe(2);
      expect(s.users[1].name).toBe("b");
      expect(s.users[1]).toBe(rowBefore); // the row keeps its identity
      expect(s.selectedUser).not.toBe(selBefore); // a different user is a different proxy
      expect(seen.at(-1) ?? seen.at(-2)).toBeDefined();
      expect(seen.filter(v => v.startsWith("row ")).at(-1)).toBe("row 2:b");
      expect(seen.filter(v => !v.startsWith("row ")).at(-1)).toBe("5:e");
    });
});
