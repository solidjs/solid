/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * #3041 follow-up: content whose async read is short-circuited while pending
 * (`{pending() ? fallback : pokemon().name}`) re-ran at landing before the
 * source's value promotion, read the previous committed value under the
 * isPending companion's lane, and was never re-notified — stuck one value
 * behind until the next write. Fixed by recording such readers for gated-sub
 * replay at commit (see pending-gated-landing-replay.test.ts in solid-signals).
 */
import { expect, test } from "vitest";
import { createMemo, createSignal, isPending, Loading, flush } from "solid-js";
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

test("content gated on !isPending is not one value behind after landing", async () => {
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
        <div id="out">{isPokemonPending() ? "loading..." : pokemon().name}</div>
      </Loading>
    );
  }, div);

  const state = () => div.querySelector("#out")?.textContent ?? `FALLBACK ${div.textContent}`;
  const resolveNext = async () => {
    const d = pending.shift()!;
    d.resolve();
    await settle();
  };

  flush();
  await resolveNext();
  expect(state()).toBe("pikachu");

  setQuery("charizard");
  flush();
  expect(state()).toBe("loading...");
  await resolveNext();
  expect(state()).toBe("charizard"); // pre-fix: stuck on "pikachu"

  dispose();
});
