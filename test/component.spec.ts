import { setDefaults } from "../src";

type SimplePropTypes = {
  a?: string | null;
  b?: string | null;
  c?: string | null;
  d?: string | null;
};
describe("Set Default Props", () => {
  test("simple set", () => {
    const props: SimplePropTypes = { a: "ji", b: null, c: "j" },
      defaultProps: SimplePropTypes = { a: "yy", b: "ggg", d: "DD" };
    setDefaults(props, defaultProps);
    expect(props.a).toBe("ji");
    expect(props.b).toBe(null);
    expect(props.c).toBe("j");
    expect(props.d).toBe("DD");
  });
});
