/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
import { describe, expect, test, vi } from "vitest";
import { createRoot } from "solid-js";

describe("ref arrays", () => {
  test("assigns a bare variable inside a ref array (#3285)", () => {
    let elementRef: HTMLDivElement | undefined;
    const el = createRoot(() => <div ref={[elementRef]} />) as HTMLDivElement;
    expect(elementRef).toBe(el);
  });

  test("assigns multiple bare variables inside a ref array", () => {
    let a: HTMLDivElement | undefined, b: HTMLDivElement | undefined;
    const el = createRoot(() => <div ref={[a, b]} />) as HTMLDivElement;
    expect(a).toBe(el);
    expect(b).toBe(el);
  });

  test("still invokes callback refs inside an array", () => {
    const calls: HTMLDivElement[] = [];
    const el = createRoot(() => (
      <div ref={[(node: HTMLDivElement) => calls.push(node)]} />
    )) as HTMLDivElement;
    expect(calls).toEqual([el]);
  });

  test("mixes bare variables and callbacks in one array", () => {
    let viaVar: HTMLDivElement | undefined;
    let viaCb: HTMLDivElement | undefined;
    const el = createRoot(() => (
      <div
        ref={[
          viaVar,
          (node: HTMLDivElement) => {
            viaCb = node;
          }
        ]}
      />
    )) as HTMLDivElement;
    expect(viaVar).toBe(el);
    expect(viaCb).toBe(el);
  });

  test("flattens nested arrays of bare variables", () => {
    let deep: HTMLDivElement | undefined;
    const el = createRoot(() => <div ref={[[deep]]} />) as HTMLDivElement;
    expect(deep).toBe(el);
  });

  test("assigns member-expression targets inside an array", () => {
    const holder: { el?: HTMLDivElement } = {};
    const el = createRoot(() => <div ref={[holder.el]} />) as HTMLDivElement;
    expect(holder.el).toBe(el);
  });

  test("invokes a const function ref passed by reference in an array", () => {
    const useEl = vi.fn();
    const el = createRoot(() => <div ref={[useEl]} />) as HTMLDivElement;
    expect(useEl).toHaveBeenCalledTimes(1);
    expect(useEl).toHaveBeenCalledWith(el);
  });

  test("invokes a mutable binding holding a function instead of overwriting it", () => {
    const calls: HTMLDivElement[] = [];
    let cb: ((node: HTMLDivElement) => void) | undefined = (node: HTMLDivElement) =>
      calls.push(node);
    const el = createRoot(() => <div ref={[cb]} />) as HTMLDivElement;
    expect(calls).toEqual([el]);
    expect(cb).toBeTypeOf("function");
  });

  test("tolerates falsy slots in a ref array", () => {
    let elementRef: HTMLDivElement | undefined;
    const el = createRoot(() => <div ref={[null, undefined, elementRef]} />) as HTMLDivElement;
    expect(elementRef).toBe(el);
  });
});
