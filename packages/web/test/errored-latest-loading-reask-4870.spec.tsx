/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
/**
 * #4870: a failed async memo under `<Errored>`, read by a `<Show>` and, under
 * a `<Loading>` beside it, through `latest()`. Once it failed it was re-asked
 * on every flush: the Loading's content read pending again on the retry, the
 * re-arm (#4634) caught it and redrew, the reveal re-derived the Errored
 * content, and its re-run retried the memo. Expected: one retry when the
 * boundary first retries, then it stays errored.
 */
import { expect, test } from "vitest";
import { createMemo, Errored, Loading, Show, latest } from "solid-js";
import { render } from "../src/index.js";

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

for (const sync of [false, true])
  test(`#4870 a failed memo beside latest() under Loading is not re-asked forever${sync ? " (rejects at once)" : ""}`, async () => {
    let requests = 0;
    const fetchUser = () => {
      requests++;
      if (requests > 50) return new Promise<string>(() => {});
      return sync
        ? Promise.reject(new Error("404"))
        : new Promise<string>((_, reject) => setTimeout(() => reject(new Error("404")), 10));
    };
    const c = document.body.appendChild(document.createElement("div"));
    const dispose = render(() => {
      const user = createMemo(() => fetchUser());
      return (
        <Errored fallback={<p>error</p>}>
          <Show when={user() === "admin"}>
            <p>admin</p>
          </Show>
          <Loading fallback={<p>loading</p>}>
            <p>{latest(user)}</p>
          </Loading>
        </Errored>
      );
    }, c);
    await wait(100);
    const at100 = requests;
    await wait(200);
    expect(c.textContent).toBe("error");
    expect(requests).toBe(at100);
    expect(requests).toBeLessThanOrEqual(2);
    dispose();
  });
