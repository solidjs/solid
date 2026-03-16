import { describe, expect, test, beforeEach, afterEach } from "vitest";
import { createRoot, createSignal, children } from "../src/index.js";
import { Show } from "../src/render/flow.js";
import { renderToString } from "solid-js/web";

/**
 * Test for issue #1977
 * Hydration error for rendered Elements that aren't inserted in the DOM during server rendering
 *
 * The issue occurs when:
 * 1. children() is called to resolve children
 * 2. The resolved children are wrapped in a <Show when={false}> or other control flow that prevents rendering
 * 3. Server-side rendering creates the children but doesn't insert them
 * 4. Client-side hydration fails to find these elements
 */
describe("Issue #1977: Hydration error for uninserted elements", () => {
  test("children() should not cause hydration errors when wrapped in Show with false condition", () => {
    const TestComponent = (props: { children: any }) => {
      const resolvedChildren = children(() => props.children);
      return <Show when={false}>{resolvedChildren()}</Show>;
    };

    // This should not throw during rendering
    let html: string;
    expect(() => {
      html = createRoot(() =>
        renderToString(() => (
          <TestComponent>
            <div>This should not cause a hydration error</div>
          </TestComponent>
        ))
      );
    }).not.toThrow();

    expect(html).toBeDefined();
  });

  test("children() should work correctly when wrapped in Show with true condition", () => {
    const TestComponent = (props: { children: any }) => {
      const resolvedChildren = children(() => props.children);
      return <Show when={true}>{resolvedChildren()}</Show>;
    };

    let html: string;
    createRoot(() => {
      html = renderToString(() => (
        <TestComponent>
          <div>This should be rendered</div>
        </TestComponent>
      ));
    });

    expect(html).toContain("This should be rendered");
  });

  test("children() should handle conditionally shown content", () => {
    const TestComponent = (props: { children: any; show: boolean }) => {
      const resolvedChildren = children(() => props.children);
      return <Show when={props.show}>{resolvedChildren()}</Show>;
    };

    let html: string;
    createRoot(() => {
      html = renderToString(() => (
        <TestComponent show={false}>
          <span>Hidden content</span>
        </TestComponent>
      ));
    });

    // Hidden content should not appear in the rendered output
    expect(html).not.toContain("Hidden content");
  });

  test("children() should not cause issues with nested Show components", () => {
    const InnerComponent = (props: { children: any }) => {
      const resolvedChildren = children(() => props.children);
      return <Show when={false}>{resolvedChildren()}</Show>;
    };

    const OuterComponent = (props: { children: any }) => {
      const resolvedChildren = children(() => props.children);
      return <Show when={true}>{resolvedChildren()}</Show>;
    };

    let html: string;
    expect(() => {
      html = createRoot(() =>
        renderToString(() => (
          <OuterComponent>
            <InnerComponent>
              <div>Nested content</div>
            </InnerComponent>
          </OuterComponent>
        ))
      );
    }).not.toThrow();

    expect(html).toBeDefined();
  });
});
