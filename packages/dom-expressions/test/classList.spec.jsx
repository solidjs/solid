import * as S from "s-js";

describe("Test classList binding", () => {
  test("Single binding", () => {
    let div;
    S.root(() => {
      const color = S.data(true),
        danger = S.data(false);
      div = <div classList={{ color: color(), danger: danger() }} />;
      expect(div.className).toBe("color");
      danger(true);
      expect(div.className).toBe("color danger");
    });
  });

  test("Multi binding", () => {
    let div;
    S.root(() => {
      const title = S.data("title"),
        color = S.data(true),
        danger = S.data(false);
      div = <div title={title()} classList={{ color: color(), danger: danger() }} />;
      expect(div.className).toBe("color");
      danger(true);
      expect(div.className).toBe("color danger");
    });
  });
});