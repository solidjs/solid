import { setDefaults, cloneProps } from "../src";

type SimplePropTypes = {
  a?: string | null;
  b?: string | null;
  c?: string | null;
  d?: string | null;
};
describe("Set Default Props", () => {
  test("simple set", () => {
    const props: SimplePropTypes = {
        get a() {
          return "ji";
        },
        b: null,
        c: "j"
      },
      defaultProps: SimplePropTypes = { a: "yy", b: "ggg", d: "DD" };
    setDefaults(props, defaultProps);
    expect(props.a).toBe("ji");
    expect(props.b).toBe(null);
    expect(props.c).toBe("j");
    expect(props.d).toBe("DD");
  });
});

describe("Clone Props", () => {
  test("simple set", () => {
    let reactive = false;
    const props: SimplePropTypes = {
        get a() {
          reactive = true;
          return "ji";
        },
        b: null,
        c: "j"
      };
    const newProps = cloneProps(props);
    expect(reactive).toBe(false);
    expect(newProps.a).toBe("ji");
    expect(reactive).toBe(true);
    expect(newProps.b).toBe(null);
    expect(newProps.c).toBe("j");
    expect(newProps.d).toBe(undefined);
  });
});
