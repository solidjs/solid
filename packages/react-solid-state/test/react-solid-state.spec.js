import React, { useRef, useCallback } from "react";
import { render, cleanup, act } from "react-testing-library";
import {
  withSolid,
  useObserver,
  useState,
  useEffect,
  useComputed,
  useMemo,
  useSignal,
  useCleanup,
  untrack
} from "../src/index.js";

const Counter = withSolid(({ onCleanup }) => {
  const [state, setState] = useState({ count: 0, tick: 0 }),
    [count, setCount] = useSignal(10),
    getCounterText = useMemo(() => `Counter ${state.count} ${count()}`);
  useComputed(() => {
    if (state.tick > 0) {
      setState("count", c => c + 1);
      setCount(untrack(count) + 1);
    }
  });
  useCleanup(() => onCleanup());
  return () => (
    <div
      onClick={() => {
        setState("tick", t => t + 1);
      }}
    >
      {getCounterText()}
    </div>
  );
});

const Nested = () => {
  const [a, setA] = useSignal(0),
    [result, setResult] = useSignal(),
    refB = useRef(),
    incrementA = useCallback(() => setA(a() + 1)),
    incrementB = useCallback(() => refB.current.set(refB.current.value() + 1));
  useEffect(() => {
    const [b, setB] = useSignal(a());
    refB.current = { value: b, set: setB };
    useEffect(() => setResult(b()));
    useCleanup(() => (refB.current = undefined));
  });
  return useObserver(() => (
    <>
      <div onClick={incrementA} />
      <div onClick={incrementB} />
      <div>{result()}</div>
    </>
  ));
};

describe("Simple Counter", () => {
  let ref, disposed;
  function handleCleanup() {
    disposed = true;
  }
  test("Create Component", () => {
    const { container } = render(<Counter onCleanup={handleCleanup} />);
    expect(container.firstChild.innerHTML).toBe("Counter 0 10");
    ref = container.firstChild;
  });
  test("Triggering Computed", () => {
    act(() => ref.click());
    expect(ref.innerHTML).toBe("Counter 1 11");
    act(() => ref.click());
    expect(ref.innerHTML).toBe("Counter 2 12");
  });
  test("Cleanup", () => {
    expect(disposed).toBeUndefined();
    cleanup();
    expect(disposed).toBe(true);
  });
});

describe("Nested Effect", () => {
  let ref;
  test("Create Component", () => {
    const { container } = render(<Nested />);
    expect(container.childNodes[2].innerHTML).toBe("0");
    ref = container.childNodes;
  });
  test("Triggering Effect", () => {
    act(() => ref[0].click());
    expect(ref[2].innerHTML).toBe("1");
    act(() => ref[1].click());
    expect(ref[2].innerHTML).toBe("2");
    act(() => ref[1].click());
    expect(ref[2].innerHTML).toBe("3");
    act(() => ref[0].click());
    expect(ref[2].innerHTML).toBe("2");
  });
  test("Cleanup", () => {
    cleanup();
  });
});
