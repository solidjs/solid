/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */

// Client counterpart of test/server/use-head-loading.spec.tsx (issue #2975).
// On the client no readiness probe is needed: useHead is a render effect
// whose compute half evaluates the descriptor's getters in a tracked scope
// under the current owner, so a pending read suspends the enclosing Loading
// boundary like any content expression, and the apply half (DOM
// registration) only runs with settled values.
import { describe, expect, test } from "vitest";
import { createMemo, createSignal, Loading, flush } from "solid-js";
import { render, useHead } from "../src/index.js";

function PageTitle(props: { text: () => string }) {
  useHead({ tag: "title", props: { children: () => props.text() } });
  return null;
}

const microtasks = async (n = 4) => {
  for (let i = 0; i < n; i++) await Promise.resolve();
};

describe("useHead under Loading — client render", () => {
  test("pending head-tag prop suspends the boundary; the title applies on settle", async () => {
    document.title = "";
    const div = document.createElement("div");
    let resolveData!: (v: string) => void;

    const dispose = render(() => {
      const data = createMemo(() => new Promise<string>(r => (resolveData = r)));
      return (
        <div>
          <Loading fallback={<span>Loading...</span>}>
            <PageTitle text={data} />
            <main>content</main>
          </Loading>
        </div>
      );
    }, div);

    expect(div.innerHTML).toContain("Loading...");
    expect(div.innerHTML).not.toContain("<main>");
    expect(document.title).toBe("");

    resolveData("Home - World");
    await microtasks();
    flush();
    await microtasks();

    expect(div.innerHTML).toContain("<main>content</main>");
    expect(document.title).toBe("Home - World");
    dispose();
  });

  test("a re-pending prop holds the previous title until the new value settles", async () => {
    document.title = "";
    const div = document.createElement("div");
    const resolvers: ((v: string) => void)[] = [];
    const [route, setRoute] = createSignal("a");

    const dispose = render(() => {
      const data = createMemo(() => {
        route();
        return new Promise<string>(r => resolvers.push(r));
      });
      return (
        <Loading fallback={<span>Loading...</span>}>
          <PageTitle text={data} />
          <main>content</main>
        </Loading>
      );
    }, div);

    resolvers[0]("Page A");
    await microtasks();
    flush();
    await microtasks();
    expect(document.title).toBe("Page A");

    // Navigation analog: the memo re-computes to a fresh pending promise.
    // The compute half is pending again — the committed title must not
    // tear to an intermediate state.
    setRoute("b");
    flush();
    await microtasks();
    expect(document.title).toBe("Page A");
    expect(div.innerHTML).toContain("<main>content</main>");

    resolvers[1]("Page B");
    await microtasks();
    flush();
    await microtasks();
    expect(document.title).toBe("Page B");
    dispose();
  });
});
