import * as S from "s-js";

describe("Test conditional operators", () => {
  test("ternary expression triggered", () => {
    let div;
    S.root(() => {
      const s = S.data(0);
      div = <div>{s() > 5 ? "Large" : "Small"}</div>;
      expect(div.innerHTML).toBe("Small");
      s(7);
      expect(div.innerHTML).toBe("Large");
    });
  });

  test("boolean expression triggered", () => {
    let div;
    S.root(() => {
      const s = S.data(0);
      div = <div>{s() > 5 && "Large"}</div>;
      expect(div.innerHTML).toBe("");
      s(7);
      expect(div.innerHTML).toBe("Large");
    });
  });

  test("ternary expression triggered once", () => {
    let div1, div2;
    S.root(() => {
      const s = S.data(6);
      <div>{s() > 5 ? (div1 = <div />) : "Small"}</div>;
      div2 = div1;
      s(7);
      expect(div1).toBe(div2);
    });
  });

  test("boolean expression triggered once", () => {
    let div1, div2;
    S.root(() => {
      const s = S.data(6);
      <div>{s() > 5 && (div1 = <div />)}</div>;
      div2 = div1;
      s(7);
      expect(div1).toBe(div2);
    });
  });

  test("ternary prop triggered", () => {
    let div;
    function Comp(props) {
      return <div ref={div}>{props.render}</div>;
    }

    S.root(() => {
      const s = S.data(0);
      <Comp render={s() > 5 ? "Large" : "Small"}/>;
      expect(div.innerHTML).toBe("Small");
      s(7);
      expect(div.innerHTML).toBe("Large");
    });
  });

  test("boolean prop triggered", () => {
    let div;
    function Comp(props) {
      return <div ref={div}>{props.render}</div>;
    }
    S.root(() => {
      const s = S.data(0);
      <Comp render={s() > 5 && "Large"}/>;
      expect(div.innerHTML).toBe("");
      s(7);
      expect(div.innerHTML).toBe("Large");
    });
  });
});
