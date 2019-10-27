import { createRoot } from "../../dist";

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
});
