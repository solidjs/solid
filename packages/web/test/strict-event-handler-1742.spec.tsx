/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * #1742: an event handler is bound once, where its element is created, so a
 * reactive read in the handler expression is a mistake (handlers are not
 * reactive). Dev DOM output reads every handler expression that can read
 * reactive state through `strictHandler`, which warns STRICT_READ_UNTRACKED
 * on such a read and still tracks it, so dev re-mounts on a change exactly
 * as production does. Production output is unchanged (0 B).
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { render } from "@solidjs/web";
import { createMemo, createSignal, createStore, Errored, flush, Loading, Show } from "solid-js";

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => warn.mockRestore());
const handlerWarnings = () =>
  warn.mock.calls
    .map((c: unknown[]) => String(c[0]))
    .filter(
      (m: string) =>
        m.includes("STRICT_READ_UNTRACKED") && m.includes("an event handler expression")
    );

function mount(fn: () => any) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const dispose = render(fn, container);
  flush();
  return {
    container,
    cleanup: () => {
      dispose();
      container.remove();
    }
  };
}

describe("dev strict window for event handler expressions (#1742)", () => {
  test("a forwarded handler prop that reads a signal warns, and still re-mounts like production", () => {
    const [selected, setSelected] = createSignal(false);
    const a = vi.fn();
    const b = vi.fn();
    const [visible] = createSignal(true);
    let mounts = 0;
    // A reactive `when`: the branch is a tracked compute in both the Show
    // component and its lowered ternary.
    function Button(props: { onClick: () => void }) {
      return (
        <Show when={visible()}>
          <button ref={() => mounts++} onClick={props.onClick} />
        </Show>
      );
    }
    const { container, cleanup } = mount(() => <Button onClick={selected() ? a : b} />);
    expect(handlerWarnings()).toHaveLength(1);
    expect(handlerWarnings()[0]).toContain("read the value inside the handler function instead");
    container.querySelector("button")!.click();
    expect(b).toHaveBeenCalledTimes(1);
    expect(mounts).toBe(1);

    // The read is tracked in dev as it is in production: the branch re-runs.
    setSelected(true);
    flush();
    expect(mounts).toBe(2);
    container.querySelector("button")!.click();
    expect(a).toHaveBeenCalledTimes(1);
    cleanup();
  });

  test("a component's root template warns too", () => {
    const [label] = createSignal("x");
    const { cleanup } = mount(() => <button onClick={(label(), () => {})} />);
    expect(handlerWarnings()).toHaveLength(1);
    cleanup();
  });

  test("a store-held handler read in a branch warns", () => {
    const [store] = createStore({ onClick: () => {} });
    const { cleanup } = mount(() => (
      <Show when={true}>
        <button onClick={store.onClick} />
      </Show>
    ));
    expect(handlerWarnings()).toHaveLength(1);
    cleanup();
  });

  test("a factory call that reads a signal warns; bound data on a delegated event too", () => {
    const [id] = createSignal(1);
    const make = (n: number) => () => n;
    const select = vi.fn();
    const { container, cleanup } = mount(() => (
      <div>
        <button onClick={make(id())} />
        <span onClick={[select, id()]} />
      </div>
    ));
    expect(handlerWarnings()).toHaveLength(2);
    (container.querySelector("span") as HTMLElement).click();
    expect(select).toHaveBeenCalledWith(1, expect.anything());
    cleanup();
  });

  test("plain function props, identifiers and inline functions are quiet", () => {
    const [count, setCount] = createSignal(0);
    const onClick = vi.fn();
    function Button(props: { onClick: () => void }) {
      return (
        <Show when={true}>
          <button id="forwarded" onClick={props.onClick} />
        </Show>
      );
    }
    const { container, cleanup } = mount(() => (
      <div>
        <Button onClick={onClick} />
        <button id="inline" onClick={() => setCount(count() + 1)} />
        <video onPlay={() => count()} />
      </div>
    ));
    (container.querySelector("#forwarded") as HTMLElement).click();
    (container.querySelector("#inline") as HTMLElement).click();
    flush();
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(count()).toBe(1);
    expect(handlerWarnings()).toHaveLength(0);
    cleanup();
  });

  test("a read inside the handler, at dispatch, is quiet", () => {
    const [count] = createSignal(0);
    const seen: number[] = [];
    const handlers = { click: () => seen.push(count()) };
    const { container, cleanup } = mount(() => <button onClick={handlers.click} />);
    container.querySelector("button")!.click();
    expect(seen).toEqual([0]);
    expect(handlerWarnings()).toHaveLength(0);
    cleanup();
  });

  test("a pending async read in a handler expression is the dev error, as in a component body", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const handler = createMemo(async () => {
      await Promise.resolve();
      return () => {};
    });
    const { container, cleanup } = mount(() => (
      <Errored fallback={err => <p>{String((err() as Error).message)}</p>}>
        <Loading fallback={<p>loading</p>}>
          <button onClick={handler()} />
        </Loading>
      </Errored>
    ));
    expect(container.textContent).toContain("[PENDING_ASYNC_UNTRACKED_READ]");
    expect(container.textContent).toContain("an event handler expression");
    cleanup();
    error.mockRestore();
  });
});
