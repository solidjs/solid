describe("Basic element attributes", () => {
  test("spread", () => {
    const props = {
        id: "main",
        name: "main",
        children: <p>Hi</p>,
        onClick: () => console.log("clicked")
      },
      d = <div {...props} />;
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
