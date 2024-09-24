/**
 * @jsxImportSource solid-js
 * @vitest-environment jsdom
 */
import { describe, expect, test } from "vitest";
import { createRoot, createSignal, createUniqueId, JSX, children } from "../../src/index.js";

declare module "solid-js/jsx-runtime" {
  namespace JSX {
    interface Directives {
      getRef: boolean;
    }
  }
}

describe("Basic element attributes", () => {
  test("spread", () => {
    let div: HTMLDivElement;
    const props: JSX.HTMLAttributes<HTMLDivElement> = {
        id: "main",
        title: "main",
        children: <p>Hi</p>,
        ref: (ref: HTMLDivElement) => {
          div = ref;
        },
        onClick: () => console.log("clicked")
      },
      d = createRoot(() => <div {...props} />) as HTMLDivElement & { $$click: any };
    expect(div!).toBe(d);
    expect(d.id).toBe("main");
    expect(d.title).toBe("main");
    expect(d.$$click).toBeDefined();
    expect(d.innerHTML).toBe("<p>Hi</p>");
  });

  test("classList", () => {
    const classes = { first: true, second: false, "third fourth": true },
      d = (<div classList={classes} />) as HTMLDivElement;
    expect(d.className).toBe("first third fourth");
  });

  test("ternary expression triggered", () =>
    new Promise(done => {
      let div: HTMLDivElement;
      createRoot(() => {
        const [s, setS] = createSignal(0);
        div = (<div>{s() > 5 ? "Large" : "Small"}</div>) as HTMLDivElement;
        expect(div.innerHTML).toBe("Small");
        setTimeout(() => {
          setS(7);
          expect(div.innerHTML).toBe("Large");
          done(undefined);
        });
      });
    }));

  test("boolean expression triggered once", () => {
    let div1: HTMLDivElement, div2: HTMLDivElement;
    createRoot(() => {
      const [s, setS] = createSignal(6);
      <div>{s() > 5 && (div1 = (<div />) as HTMLDivElement)}</div>;
      div2 = div1;
      setS(7);
      expect(div1).toBe(div2);
    });
  });

  test("directives work properly", () => {
    let ref: HTMLDivElement,
      el!: HTMLDivElement,
      getRef = (el: HTMLDivElement) => (ref = el),
      d = (<div use:getRef ref={el} />) as HTMLDivElement;
    expect(ref!).toBe(el);
  });

  test("uniqueId", () => {
    let div: HTMLDivElement;
    createRoot(() => {
      const id = createUniqueId();
      div = (
        <div>
          <label for={id}>Hi</label>
          <input type="text" id={id} />
        </div>
      ) as HTMLDivElement;
    });
    expect((div!.firstChild as HTMLLabelElement).htmlFor).toBe(
      (div!.firstChild!.nextSibling as HTMLInputElement).id
    );
  });

  test("children", () => {
    const Comp = (props: { children?: JSX.Element }) => {
      const c = children(() => props.children);
      return (
        <>
          {c.toArray().map(i => (
            <div>{i}</div>
          ))}
        </>
      );
    };
    const res: HTMLDivElement = createRoot(() => {
      return (
        <div>
          <Comp>
            <span>Hello</span>
          </Comp>
          <Comp>
            <span>Hello</span>
            <span>Jake</span>
          </Comp>
          <Comp />
        </div>
      ) as HTMLDivElement;
    });
    expect(res.innerHTML).toBe(
      "<div><span>Hello</span></div><div><span>Hello</span></div><div><span>Jake</span></div>"
    );
  });
});
