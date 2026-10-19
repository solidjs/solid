/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// #4142, the report's playground: a lazy async memo read in both operands of
// `user() && <User data={user()} />` under <Show>/<Loading>. The compiled
// condition is a child memo of the hole's pass, and rebuilding it released
// the lazy memo, which re-fetched forever behind the fallback.
import { expect, test } from "vitest";
import { createMemo, createSignal, flush, Loading, Show } from "solid-js";
import { render } from "../src/index.js";

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

test("a lazy async memo read on both sides of && fetches once and shows", async () => {
  let fetches = 0;
  const fetchUser = async () => {
    fetches++;
    await wait(5);
    return { name: "admin" };
  };
  const User = (props: { data: { name: string } }) => <div>Name: {props.data.name}</div>;
  const [showUser, setShowUser] = createSignal(false);
  const user = createMemo(fetchUser, { lazy: true });
  const div = document.createElement("div");
  document.body.appendChild(div);
  const dispose = render(
    () => (
      <div>
        <input type="checkbox" onChange={() => setShowUser(x => !x)} />
        <Show when={showUser()}>
          <Loading fallback="loading">{user() && <User data={user()} />}</Loading>
        </Show>
      </div>
    ),
    div
  );
  div.querySelector("input")!.dispatchEvent(new Event("change", { bubbles: true }));
  flush();
  for (let i = 0; i < 10; i++) await wait(5);
  expect(fetches).toBe(1);
  expect(div.textContent).toContain("Name: admin");
  dispose();
  div.remove();
});
