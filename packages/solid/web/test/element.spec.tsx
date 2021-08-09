/* @jsxImportSource solid-js */
import { createRoot, createSignal, createUniqueId, JSX } from "../../src";

declare module "solid-js" {
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

  test("ternary expression triggered", done => {
    let div: HTMLDivElement;
    createRoot(() => {
      const [s, setS] = createSignal(0);
      div = (<div>{s() > 5 ? "Large" : "Small"}</div>) as HTMLDivElement;
      expect(div.innerHTML).toBe("Small");
      setTimeout(() => {
        setS(7);
        expect(div.innerHTML).toBe("Large");
        done();
      });
    });
  });

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
});
