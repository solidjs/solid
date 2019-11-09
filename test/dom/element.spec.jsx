import { createRoot, createSignal } from "../../dist";

describe("Basic element attributes", () => {
  test("spread", () => {
    let div;
    const props = {
        id: "main",
        name: "main",
        children: <p>Hi</p>,
        ref: ref => (div = ref),
        onClick: () => console.log("clicked")
      },
      d = createRoot(() => <div {...props} />);
    expect(div).toBe(d);
    expect(d.id).toBe("main");
    expect(d.name).toBe("main");
    expect(d.__click).toBeDefined();
    expect(d.innerHTML).toBe("<p>Hi</p>");
  });

  test("classList", () => {
    const classes = { first: true, second: false, "third fourth": true },
      d = <div classList={classes} />;
    expect(d.className).toBe("first third fourth");
  });

  test("ternary expression triggered", () => {
    let div;
    createRoot(() => {
      const [s, setS] = createSignal(0);
      div = <div>{s() > 5 ? "Large" : "Small"}</div>;
      expect(div.innerHTML).toBe("Small");
      setS(7);
      expect(div.innerHTML).toBe("Large");
    });
  });

  test("boolean expression triggered once", () => {
    let div1, div2;
    createRoot(() => {
      const [s, setS] = createSignal(6);
      <div>{s() > 5 && (div1 = <div />)}</div>;
      div2 = div1;
      setS(7);
      expect(div1).toBe(div2);
    });
  });
});
