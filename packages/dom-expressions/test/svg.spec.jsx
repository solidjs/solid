import * as S from "s-js";

describe("create simple svg", () => {
  it("Ensure dynamic props are set as attributes", () => {
    let rect;
    const x = S.data(0),
      y = S.data(0),
      style = S.data({
        fill: "red",
        stroke: "black",
        "stroke-width": 5,
        opacity: 0.5
      }),
      props = {
        class: "classy",
        title: "hello"
      };
    function Component() {
      return (
        <svg width="400" height="180">
          <rect x={x()} y={y()} ref={rect} width="150" height="150" style={style()} {...props} />
        </svg>
      );
    }

    S.root(() => <Component />);
    expect(rect.outerHTML).toBe(
      `<rect width="150" height="150" class="classy" title="hello" x="0" y="0" style="fill: red; stroke: black; stroke-width: 5; opacity: 0.5;"></rect>`
    );
    x(10);
    y(50);
    expect(rect.outerHTML).toBe(
      `<rect width="150" height="150" class="classy" title="hello" x="10" y="50" style="fill: red; stroke: black; stroke-width: 5; opacity: 0.5;"></rect>`
    );
  });
});
