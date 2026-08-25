/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * #3041 follow-up: with a real macrotask gap after a landing (human click
 * timing — same-task sequences pass), the next transition's banner showed the
 * previous transition's target. Two cooperating defects: the latest() shadow
 * auto-disposes when its gated reader unmounts at the landing, and a sync
 * write into the corpse equality-swallows against its frozen _value; the
 * later read then revives the corpse from the committed view. Fixed by
 * recreating a disposed shadow on access (getLatestValueComputed) and by not
 * letting a dirty node's stale _value swallow an optimistic write.
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
const timer = (ms = 0) => new Promise(r => setTimeout(r, ms));

test("banner latest() correct on first click after a landing + task gap", async () => {
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
  await resolveNext();
  await timer(5);
  flush();
  expect(state()).toBe("Current: pikachu");

  // Transition 1 lands, then a real macrotask gap before the next click.
  setQuery("charizard");
  flush();
  await resolveNext();
  await timer(5);
  flush();
  expect(state()).toBe("Current: charizard");

  setQuery("gengar");
  flush();
  expect(state()).toBe("Current: charizard / Now Loading: gengar");
  await resolveNext();
  await timer(5);
  flush();
  expect(state()).toBe("Current: gengar");

  // The user's sequence: click charizard soon after gengar landed.
  setQuery("charizard");
  flush();
  expect(state()).toBe("Current: gengar / Now Loading: charizard");

  dispose();
});
