import { createRoot, createSignal } from "../../src";

describe("Basic element attributes", () => {
  test("spread", () => {
    let div: HTMLDivElement;
    const props: JSX.HTMLAttributes<HTMLDivElement> = {
        id: "main",
        title: "main",
        children: <p>Hi</p>,
        ref: (ref: HTMLDivElement) => {div = ref},
        onClick: () => console.log("clicked")
      },
      d = createRoot(() => <div {...props} />) as HTMLDivElement & {__click: any};
    expect(div!).toBe(d);
    expect(d.id).toBe("main");
    expect(d.title).toBe("main");
    expect(d.__click).toBeDefined();
    expect(d.innerHTML).toBe("<p>Hi</p>");
  });

  test("classList", () => {
    const classes = { first: true, second: false, "third fourth": true },
      d = <div classList={classes} /> as HTMLDivElement;
    expect(d.className).toBe("first third fourth");
  });

  test("ternary expression triggered", () => {
    let div: HTMLDivElement;
    createRoot(() => {
      const [s, setS] = createSignal(0);
      div = <div>{s() > 5 ? "Large" : "Small"}</div> as HTMLDivElement;
      expect(div.innerHTML).toBe("Small");
      setS(7);
      expect(div.innerHTML).toBe("Large");
    });
  });

  test("boolean expression triggered once", () => {
    let div1: HTMLDivElement, div2: HTMLDivElement;
    createRoot(() => {
      const [s, setS] = createSignal(6);
      <div>{s() > 5 && (div1 = <div /> as HTMLDivElement)}</div>;
      div2 = div1;
      setS(7);
      expect(div1).toBe(div2);
    });
  });
});
