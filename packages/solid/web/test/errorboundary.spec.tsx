/**
 * @jsxImportSource solid-js
 * @vitest-environment jsdom
 */

import { createRoot, resetErrorBoundaries } from "../../src";
import { ErrorBoundary } from "../src";

describe("Testing ErrorBoundary control flow", () => {
  let div: HTMLDivElement, disposer: () => void;

  const Component = () => {
    throw new Error("Failure");
  };

  let first = true;
  const Component2 = () => {
    if (first) {
      first = false;
      throw new Error("Failure");
    }
    return "Success";
  };

  const Component3 = () => {
    throw null;
  };

  test("Create an Error", () => {
    createRoot(dispose => {
      disposer = dispose;
      <div ref={div}>
        <ErrorBoundary fallback="Failed Miserably">
          <Component />
        </ErrorBoundary>
      </div>;
    });
    expect(div.innerHTML).toBe("Failed Miserably");
  });

  test("Create an Error with null", () => {
    createRoot(dispose => {
      disposer = dispose;
      <div ref={div}>
        <ErrorBoundary fallback="Failed Miserably">
          <Component3 />
        </ErrorBoundary>
      </div>;
    });
    expect(div.innerHTML).toBe("Failed Miserably");
  });

  test("Create an Error callback", () => {
    createRoot(dispose => {
      disposer = dispose;
      <div ref={div}>
        <ErrorBoundary fallback={e => e.message}>
          <Component />
        </ErrorBoundary>
      </div>;
    });
    expect(div.innerHTML).toBe("Failure");
  });

  test("Create an Error callback and reset", () => {
    let r: () => void;
    createRoot(dispose => {
      disposer = dispose;
      <div ref={div}>
        <ErrorBoundary
          fallback={(e, reset) => {
            r = reset;
            return e.message;
          }}
        >
          <Component2 />
        </ErrorBoundary>
      </div>;
    });
    expect(div.innerHTML).toBe("Failure");
    r!();
    expect(div.innerHTML).toBe("Success");
    first = true;
  });

  test("Create an Error global reset", () => {
    let r: () => void;
    createRoot(dispose => {
      disposer = dispose;
      <div ref={div}>
        <ErrorBoundary fallback={e => e.message}>
          <Component2 />
        </ErrorBoundary>
      </div>;
    });
    expect(div.innerHTML).toBe("Failure");
    resetErrorBoundaries();
    expect(div.innerHTML).toBe("Success");
    first = true;
  });

  test("Create an Error in an Error Fallback", () => {
    createRoot(dispose => {
      disposer = dispose;
      <div ref={div}>
        <ErrorBoundary fallback="Failed Miserably">
          <ErrorBoundary fallback={<Component />}>
            <Component />
          </ErrorBoundary>
        </ErrorBoundary>
      </div>;
    });
    expect(div.innerHTML).toBe("Failed Miserably");
  });

  test("dispose", () => disposer());
});
