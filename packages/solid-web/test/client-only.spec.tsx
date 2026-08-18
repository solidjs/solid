/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * Client half of `clientOnly`: shows the fallback until the import resolves,
 * then swaps the real component in; `{ lazy: true }` defers the import to
 * first render.
 */
import { describe, expect, test, vi } from "vitest";
import { flush, type Component } from "solid-js";
import { render, clientOnly } from "../src/index.js";

function deferredModule<T extends Component<any>>(component: T) {
  let resolve!: () => void;
  const promise = new Promise<{ default: T }>(r => {
    resolve = () => r({ default: component });
  });
  return { importer: vi.fn(() => promise), resolve };
}

async function settle() {
  // importer promise → setComp → reactive flush
  await Promise.resolve();
  await Promise.resolve();
  flush();
}

describe("clientOnly (client)", () => {
  test("starts the import eagerly by default", () => {
    const { importer } = deferredModule(() => <span>widget</span>);
    clientOnly(importer);
    expect(importer).toHaveBeenCalledTimes(1);
  });

  test("lazy option defers the import to first render", async () => {
    const { importer, resolve } = deferredModule(() => <span>widget</span>);
    const Widget = clientOnly(importer, { lazy: true });
    expect(importer).not.toHaveBeenCalled();

    const div = document.createElement("div");
    const dispose = render(() => <Widget fallback={<i>wait</i>} />, div);
    expect(importer).toHaveBeenCalledTimes(1);

    resolve();
    await settle();
    expect(div.innerHTML).toContain("widget");
    dispose();
  });

  test("lazy import starts once no matter how many instances render", async () => {
    const { importer, resolve } = deferredModule(() => <span>widget</span>);
    const Widget = clientOnly(importer, { lazy: true });

    const div = document.createElement("div");
    const dispose = render(
      () => (
        <>
          <Widget fallback={<i>a</i>} />
          <Widget fallback={<i>b</i>} />
        </>
      ),
      div
    );
    // Both instances share the one module signal; the first render started
    // the import and the second must not re-invoke the importer.
    expect(importer).toHaveBeenCalledTimes(1);

    resolve();
    await settle();
    expect(div.querySelectorAll("span")).toHaveLength(2);
    expect(importer).toHaveBeenCalledTimes(1);
    dispose();
  });

  test("renders the fallback until the module loads, then swaps", async () => {
    const { importer, resolve } = deferredModule((props: { name: string }) => (
      <span>hello {props.name}</span>
    ));
    const Widget = clientOnly(importer);

    const div = document.createElement("div");
    const dispose = render(() => <Widget name="io" fallback={<i>wait</i>} />, div);
    expect(div.innerHTML).toContain("<i>wait</i>");

    resolve();
    await settle();
    expect(div.innerHTML).toContain("hello ");
    expect(div.textContent).toContain("io");
    expect(div.innerHTML).not.toContain("<i>wait</i>");
    dispose();
  });

  test("{ export } picks a named export of the resolved module (#3011)", async () => {
    let resolve!: () => void;
    const Chart = (props: { name: string }) => <span>chart {props.name}</span>;
    const promise = new Promise<{ Chart: typeof Chart; Legend: Component }>(r => {
      resolve = () => r({ Chart, Legend: () => <i>legend</i> });
    });
    const Widget = clientOnly(() => promise, { export: "Chart" });

    const div = document.createElement("div");
    const dispose = render(() => <Widget name="io" fallback={<i>wait</i>} />, div);
    expect(div.innerHTML).toContain("<i>wait</i>");

    resolve();
    await settle();
    expect(div.innerHTML).toContain("chart ");
    expect(div.textContent).toContain("io");
    dispose();
  });

  test("does not forward the fallback prop to the loaded component", async () => {
    let seen: Record<string, unknown> | undefined;
    const { importer, resolve } = deferredModule((props: Record<string, unknown>) => {
      seen = props;
      return <span>done</span>;
    });
    const Widget = clientOnly(importer);

    const div = document.createElement("div");
    const dispose = render(() => <Widget id="x" fallback={<i>wait</i>} />, div);
    resolve();
    await settle();
    expect(div.innerHTML).toContain("done");
    expect(seen).toBeDefined();
    expect("fallback" in seen!).toBe(false);
    expect(seen!.id).toBe("x");
    dispose();
  });
});
