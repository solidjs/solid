/* @jsxImportSource solid-js */
import { createRoot } from "../../src";
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
