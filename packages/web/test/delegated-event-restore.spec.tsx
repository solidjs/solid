/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
import { describe, expect, test } from "vitest";
import { render } from "@solidjs/web";

describe("delegated dispatch restores the native Event", () => {
  test("a native listener above the render root sees its own currentTarget", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    let btn!: HTMLButtonElement;
    const seen: any[] = [];
    const listener = (e: Event) => seen.push(e.currentTarget);
    document.addEventListener("click", listener);
    const dispose = render(() => <section><button ref={btn} onClick={() => {}} /></section>, root);
    btn.click();
    document.removeEventListener("click", listener);
    dispose();
    root.remove();
    expect(seen[0]).toBe(document);
  });

  test("a native listener on the root's ancestor sees its own currentTarget", () => {
    const outer = document.createElement("div");
    const root = document.createElement("div");
    outer.appendChild(root);
    document.body.appendChild(outer);
    let btn!: HTMLButtonElement;
    const seen: any[] = [];
    outer.addEventListener("click", e => seen.push(e.currentTarget));
    const dispose = render(() => <button ref={btn} onClick={() => {}} />, root);
    btn.click();
    dispose();
    outer.remove();
    expect(seen[0]).toBe(outer);
  });

  test("a throwing handler still restores currentTarget and target", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    let btn!: HTMLButtonElement;
    const dispose = render(() => <button ref={btn} onClick={() => { throw new Error("boom"); }} />, root);
    const e = new MouseEvent("click", { bubbles: true });
    const onError = (ev: ErrorEvent) => ev.preventDefault();
    window.addEventListener("error", onError);
    let seen: any;
    document.addEventListener("click", ev => (seen = [ev.currentTarget, ev.target]), { once: true });
    btn.dispatchEvent(e);
    window.removeEventListener("error", onError);
    expect(seen).toEqual([document, btn]);
    expect(Object.getOwnPropertyNames(e)).not.toContain("currentTarget");
    expect(Object.getOwnPropertyNames(e)).not.toContain("target");
    dispose();
    root.remove();
  });
});

describe("re-dispatching a delegated event object", () => {
  test.fails("the same Event object dispatched twice runs the handler twice", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    let btn!: HTMLButtonElement;
    let calls = 0;
    const dispose = render(() => <button ref={btn} onClick={() => calls++} />, root);
    const e = new MouseEvent("click", { bubbles: true });
    btn.dispatchEvent(e);
    btn.dispatchEvent(e);
    expect(calls).toBe(2);
    dispose();
    root.remove();
  });
  test("re-dispatching to another element reports the new target", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    let a!: HTMLButtonElement, b!: HTMLButtonElement;
    const targets: any[] = [];
    const dispose = render(() => <div><button ref={a} onClick={() => {}} /><button ref={b} /></div>, root);
    const e = new MouseEvent("click", { bubbles: true });
    a.dispatchEvent(e);
    const native: any[] = [];
    b.addEventListener("click", ev => native.push(ev.target));
    b.dispatchEvent(e);
    expect(native[0]).toBe(b);
    dispose();
    root.remove();
  });

  test.fails("nested roots each run once per dispatch of the same Event object", () => {
    const outerRoot = document.createElement("div");
    document.body.appendChild(outerRoot);
    let slot!: HTMLDivElement, btn!: HTMLButtonElement;
    const calls: string[] = [];
    const disposeOuter = render(() => <div ref={slot} onClick={() => calls.push("outer")} />, outerRoot);
    const innerRoot = document.createElement("div");
    slot.appendChild(innerRoot);
    const disposeInner = render(() => <button ref={btn} onClick={() => calls.push("inner")} />, innerRoot);
    const e = new MouseEvent("click", { bubbles: true });
    btn.dispatchEvent(e);
    btn.dispatchEvent(e);
    expect(calls).toEqual(["inner", "outer", "inner", "outer"]);
    disposeInner();
    disposeOuter();
    outerRoot.remove();
  });
});
