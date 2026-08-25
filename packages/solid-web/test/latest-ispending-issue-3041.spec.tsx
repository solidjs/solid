/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * Follow-up to #3041: user reports latest()/content still "one value behind
 * sometimes" on rc.2. Mirrors the issue's app shape exactly: async memo under
 * <Loading>, content reads pokemon().name, banner gated on isPending shows
 * latest(() => query()).
 */
import { expect, test } from "vitest";
import { createMemo, createSignal, isPending, latest, Loading, flush } from "solid-js";
import { render } from "../src/index.js";

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>(r => (resolve = r));
  return { promise, resolve };
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
  flush();
}

test("issue #3041 app shape: banner and content across sequential transitions", async () => {
  const div = document.createElement("div");
  const [query, setQuery] = createSignal("pikachu");
  const pending: { name: string; resolve: () => void }[] = [];
  const fakeFetch = (name: string) => {
    const d = deferred<void>();
    pending.push({ name, resolve: d.resolve });
    return d.promise.then(() => ({ name }));
  };

  const dispose = render(() => {
    const pokemon = createMemo(() => fakeFetch(query()));
    const isPokemonPending = () => isPending(() => pokemon());
    return (
      <Loading fallback={<div>skeleton</div>} on={query}>
        <div id="current">Current: {pokemon().name}</div>
        {isPokemonPending() && (
          <p id="banner">
            Now Loading: <b>{latest(() => query())}</b>
          </p>
        )}
      </Loading>
    );
  }, div);

  const state = () => {
    const cur = div.querySelector("#current");
    if (!cur) return `FALLBACK ${div.textContent}`;
    const banner = div.querySelector("#banner");
    return `${cur.textContent}${banner ? ` / ${banner.textContent}` : ""}`;
  };
  const resolveNext = async () => {
    const d = pending.shift()!;
    d.resolve();
    await settle();
  };

  flush();
  expect(state()).toBe("FALLBACK skeleton");
  await resolveNext();
  expect(state()).toBe("Current: pikachu");

  // Transition 1: pikachu -> charizard
  setQuery("charizard");
  flush();
  expect(state()).toBe("Current: pikachu / Now Loading: charizard");
  await resolveNext();
  expect(state()).toBe("Current: charizard");

  // Transition 2: charizard -> gengar
  setQuery("gengar");
  flush();
  expect(state()).toBe("Current: charizard / Now Loading: gengar");
  await resolveNext();
  expect(state()).toBe("Current: gengar");

  // Transition 3: back to pikachu
  setQuery("pikachu");
  flush();
  expect(state()).toBe("Current: gengar / Now Loading: pikachu");
  await resolveNext();
  expect(state()).toBe("Current: pikachu");

  dispose();
});

test("issue #3041 app shape: rapid clicks mid-flight", async () => {
  const div = document.createElement("div");
  const [query, setQuery] = createSignal("pikachu");
  const pending: { name: string; resolve: () => void }[] = [];
  const fakeFetch = (name: string) => {
    const d = deferred<void>();
    pending.push({ name, resolve: d.resolve });
    return d.promise.then(() => ({ name }));
  };

  const dispose = render(() => {
    const pokemon = createMemo(() => fakeFetch(query()));
    const isPokemonPending = () => isPending(() => pokemon());
    return (
      <Loading fallback={<div>skeleton</div>} on={query}>
        <div id="current">Current: {pokemon().name}</div>
        {isPokemonPending() && (
          <p id="banner">
            Now Loading: <b>{latest(() => query())}</b>
          </p>
        )}
      </Loading>
    );
  }, div);

  const state = () => {
    const cur = div.querySelector("#current");
    if (!cur) return `FALLBACK ${div.textContent}`;
    const banner = div.querySelector("#banner");
    return `${cur.textContent}${banner ? ` / ${banner.textContent}` : ""}`;
  };

  flush();
  pending.shift()!.resolve();
  await settle();
  expect(state()).toBe("Current: pikachu");

  // Click charizard, then gengar before charizard's fetch resolves.
  setQuery("charizard");
  flush();
  expect(state()).toBe("Current: pikachu / Now Loading: charizard");
  setQuery("gengar");
  flush();
  expect(state()).toBe("Current: pikachu / Now Loading: gengar");

  // Resolve the abandoned charizard fetch first, then gengar's.
  pending.shift()!.resolve();
  await settle();
  expect(state()).toBe("Current: pikachu / Now Loading: gengar");
  pending.shift()!.resolve();
  await settle();
  expect(state()).toBe("Current: gengar");

  dispose();
});
