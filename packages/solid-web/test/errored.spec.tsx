/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
import { describe, expect, test } from "vitest";
import { createRoot, Errored, flush } from "solid-js";

describe("Testing Errored control flow", () => {
  let div!: HTMLDivElement, disposer: () => void;

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
        <Errored fallback="Failed Miserably">
          <Component />
        </Errored>
      </div>;
    });
    expect(div.innerHTML).toBe("Failed Miserably");
  });

  test("Create an Error with null", () => {
    createRoot(dispose => {
      disposer = dispose;
      <div ref={div}>
        <Errored fallback="Failed Miserably">
          <Component3 />
        </Errored>
      </div>;
    });
    expect(div.innerHTML).toBe("Failed Miserably");
  });

  test("Create an Error callback", () => {
    createRoot(dispose => {
      disposer = dispose;
      <div ref={div}>
        <Errored fallback={e => e.message}>
          <Component />
        </Errored>
      </div>;
    });
    expect(div.innerHTML).toBe("Failure");
  });

  test("Create an Error callback and reset", () => {
    let r: () => void;
    createRoot(dispose => {
      disposer = dispose;
      <div ref={div}>
        <Errored
          fallback={(e, reset) => {
            r = reset;
            return e.message;
          }}
        >
          <Component2 />
        </Errored>
      </div>;
    });
    expect(div.innerHTML).toBe("Failure");
    flush();

    r!();
    flush();
    expect(div.innerHTML).toBe("Success");
    first = true;
  });

  test("Create an Error in an Error Fallback", () => {
    createRoot(dispose => {
      disposer = dispose;
      <div ref={div}>
        <Errored fallback="Failed Miserably">
          <Errored fallback={<Component />}>
            <Component />
          </Errored>
        </Errored>
      </div>;
    });
    expect(div.innerHTML).toBe("Failed Miserably");
  });

  test("dispose", () => disposer());
});
