/**
 * @jsxImportSource solid-js
 * @vitest-environment jsdom
 */
import { describe, expect, test } from "vitest";
import { createProjection, flush, For, Loading, refresh, Show, type Component } from "solid-js";
import { render } from "../src/index.js";

interface Node2 {
  id: string;
  parentId: string | null;
}

type WithChildren<T> = T & { children: WithChildren<T>[] };

function convertToTree<T extends { parentId?: unknown; id: unknown }>(
  items: T[]
): WithChildren<Omit<T, "children">>[] {
  const nodes = new Map();
  const roots: any[] = [];
  for (const item of items) {
    nodes.set(item.id, { ...item, children: [] });
  }
  for (const node of nodes.values()) {
    let parent;
    if (node.parentId && (parent = nodes.get(node.parentId))) {
      if (node.id == node.parentId) continue;
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

const stateA: Node2[] = [
  { id: "2", parentId: null },
  { id: "3", parentId: "2" },
  { id: "1", parentId: null },
  { id: "4", parentId: "2" },
  { id: "5", parentId: "2" }
];
const stateB: Node2[] = [
  { id: "2", parentId: null },
  { id: "1", parentId: null },
  { id: "3", parentId: "2" },
  { id: "4", parentId: "1" },
  { id: "5", parentId: "1" }
];

describe("Issue #2620 - createProjection + For + Show tree", () => {
  test("async createProjection with refresh, cycling two tree states", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    let flipflop = 1;
    function generateInputs() {
      const input = flipflop ? stateA : stateB;
      flipflop ^= 1;
      return input;
    }

    let proj: any;
    let disposer: () => void;

    const Item: Component<{ items: readonly any[]; id: string | null }> = props => {
      return (
        <ul>
          <For each={props.items} keyed={(v: any) => v.id}>
            {item => {
              return (
                <Show when={props.id === item().parentId} keyed={true}>
                  <li data-id={item().id} data-parent={item().parentId}>
                    <p>
                      {item().id} {"-->"} {JSON.stringify(item().parentId)}
                    </p>
                    <div>
                      <Item items={item().children} id={item().id} />
                    </div>
                  </li>
                </Show>
              );
            }}
          </For>
        </ul>
      );
    };

    disposer = render(
      () => (
        <Loading fallback={"Loading..."}>
          {(() => {
            proj = createProjection(
              async function () {
                const input = generateInputs();
                return convertToTree(input);
              },
              [],
              { key: "id" }
            );
            return <Item items={proj} id={null} />;
          })()}
        </Loading>
      ),
      container
    );

    await new Promise(r => setTimeout(r, 50));
    flush();

    const countLis = () => container.querySelectorAll("li").length;

    const initialCount = countLis();
    expect(initialCount).toBe(5);

    refresh(proj);
    await new Promise(r => setTimeout(r, 50));
    flush();

    const afterRefresh1 = countLis();
    expect(afterRefresh1).toBe(5);

    disposer();
    container.remove();
  });
});
