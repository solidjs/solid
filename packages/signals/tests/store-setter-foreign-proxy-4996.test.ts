// #4996: a store that holds another store's proxy re-wraps it in its own
// proxy family (CS-R3), so the holder's setter writes its own copy and never
// the other store (CS-R4: writes stay in the store that made them). The
// function form already does this (§7b chained backing). A plain store
// still passes the proxy through, so the write lands in the source store;
// the thin-engine rewrite (#4906) fixes it. Pinned until then.
import { test, expect } from "vitest";
import { createStore, flush } from "../src/index.js";

const cases = [
  ["plain", (person: { name: string }) => createStore({ people: [person] })],
  ["function", (person: { name: string }) => createStore(() => ({ people: [person] }))]
] as const;

for (const [form, make] of cases) {
  const run = form === "plain" ? test.fails : test;
  run(`#4996 a ${form} store's setter does not write into a store it holds`, () => {
    const [person, setPerson] = createStore({ name: "Alice" });
    const [list, setList] = make(person);
    flush();
    setList(d => {
      d.people[0].name = "Bob";
    });
    flush();
    expect(list.people[0].name).toBe("Bob");
    expect(person.name).toBe("Alice");
    setPerson(d => {
      d.name = "Carol";
    });
    flush();
    expect(person.name).toBe("Carol");
    expect(list.people[0].name).toBe("Bob");
  });
}
