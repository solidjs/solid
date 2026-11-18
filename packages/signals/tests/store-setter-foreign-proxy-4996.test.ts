// #4996 (ruled 2026-11-18): a plain store is not a boundary. Identity follows
// the raw object (CS-R2), so a store placed in a plain store is that store:
// shared state, an edit through either shows in both. A derived store is
// the boundary: it derives, so it holds its own view of a store in its value
// (CS-R3), writes stay in the view (CS-R4) and it follows the source (CS-R5).
import { test, expect } from "vitest";
import { createStore, flush } from "../src/index.js";

test("#4996 a plain store holding a store shares it: one identity, one state", () => {
  const [person, setPerson] = createStore({ name: "Alice" });
  const [list, setList] = createStore({ people: [person] });
  const [other] = createStore({ people: [person] });
  flush();
  expect(list.people[0]).toBe(person);
  setList(d => {
    d.people[0].name = "Bob";
  });
  flush();
  expect(list.people[0].name).toBe("Bob");
  expect(other.people[0].name).toBe("Bob");
  expect(person.name).toBe("Bob");
  setPerson(d => {
    d.name = "Carol";
  });
  flush();
  expect(list.people[0].name).toBe("Carol");
});

test("#4996 a store pushed into a plain store later is shared the same way", () => {
  const [person] = createStore({ name: "Alice" });
  const [people, edit] = createStore<{ name: string }[]>([]);
  edit(d => {
    d.push(person);
  });
  flush();
  expect(people[0]).toBe(person);
  edit(d => {
    d[0].name = "Bob";
  });
  flush();
  expect(people[0].name).toBe("Bob");
  expect(person.name).toBe("Bob");
});

test("#4996 a derived store's setter does not write into a store it holds", () => {
  const [person, setPerson] = createStore({ name: "Alice" });
  const [list, setList] = createStore(() => ({ people: [person] }));
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
