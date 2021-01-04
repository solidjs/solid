/* @jsxImportSource solid-js */
import { createRoot } from "../../src";
import { ErrorBoundary } from "../src";

describe("Testing ErrorBoundary control flow", () => {
  let div: HTMLDivElement, disposer: () => void;

  const Component = () => {
    throw new Error("Failure");
  };

  test("Create an Error", () => {
    createRoot(dispose => {
      disposer = dispose;
      <div ref={div}><ErrorBoundary fallback="Failed Miserably"><Component /></ErrorBoundary></div>;
    });
    expect(div.innerHTML).toBe("Failed Miserably");
  });

  test("Create an Error callback", () => {
    createRoot(dispose => {
      disposer = dispose;
      <div ref={div}><ErrorBoundary fallback={e => e.message}><Component /></ErrorBoundary></div>;
    });
    expect(div.innerHTML).toBe("Failure");
  });

  test("dispose", () => disposer());
});
