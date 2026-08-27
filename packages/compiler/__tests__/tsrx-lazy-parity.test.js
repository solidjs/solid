const { compileBabel, compileOxc, normalize } = require("./parity/harness");

const options = {
  moduleName: "@solidjs/web",
  builtIns: ["For", "Show", "Switch", "Match", "Errored", "Loading", "Dynamic"],
  generate: "dom",
  wrapConditionals: true,
  contextToCustomElements: true,
  requireImportSource: false
};

function compare(source) {
  const babel = compileBabel(source, options, "lazy-parity.tsrx");
  const oxc = compileOxc(source, "lazy-parity", options, ".tsrx");
  expect(normalize(oxc)).toBe(normalize(babel));
}

describe("native TSRX advanced lazy parity", () => {
  test("matches defaults, compound assignments, and updates", () => {
    compare(`
      export function run() @{
        let backing;
        let fallbacks = 0;
        const source = {
          get value() {
            return backing;
          },
          set value(next) {
            backing = next;
          }
        };
        let &{ value = ++fallbacks } = source;
        const first = value;
        const post = value++;
        const pre = ++value;
        value &&= 2;
        value ||= 3;
        value ??= 4;
        value += 5;
        return { first, post, pre, value, backing, fallbacks };
        <p />
      }
    `);
  });

  test("matches nested plain patterns, computed keys, holes, and rest", () => {
    compare(`
      export function run() @{
        const source = {
          nested: { value: undefined },
          selected: 1,
          other: 2
        };
        let &{
          nested: { ["value"]: renamed = 3 },
          selected,
          ...rest
        } = source;
        const arrayLike = { 0: "a", 2: "c", 3: "d", length: 4 };
        let &[head, , third, ...tail] = arrayLike;
        return [renamed, selected, rest, head, third, tail];
        <p />
      }
    `);
  });

  test("matches Dynamic lowering for non-JSX-compatible bindings", () => {
    compare(`
      export function View(&{ Component = "div" }) @{
        <Component title="ok" />
      }
    `);
  });

  test("matches typed, defaulted, nested, and async lazy arrow parameters", () => {
    compare(`
      interface Props {
        label?: string;
        nested: { count: number };
        extra: string;
      }

      const fallback: Props = { nested: { count: 0 }, extra: "fallback" };

      export const View = async (
        prefix: string,
        &{ label = prefix, nested: &{ count }, ...rest }: Props = fallback
      ) => <p>{label}: {count} / {rest.extra}</p>;
    `);
  });

  test("recursively rewrites lazy bindings in embedded expressions", () => {
    compare(`
      export function run() @{
        const source = {};
        let &{ a = 1, b = a } = source;
        const outer = { key: "target" };
        let &{ key } = outer;
        const computed = { target: undefined };
        let &{ [key]: value = key } = computed;
        return [a, b, value];
        <p />
      }
    `);
  });

  test("matches lazy bindings scoped to classic and for-of loops", () => {
    compare(`
      export function run() @{
        const seen = [];
        const counter = { value: 0 };
        for (let &{ value } = counter; value < 3; value++) {
          seen.push(value);
        }
        for (const &{ value } of [{ value: 3 }, { value: 4 }]) {
          seen.push(value);
        }
        return [seen, counter.value];
        <p />
      }
    `);
  });

  test("matches keyed loops with destructured deferred bindings", () => {
    compare(`
      export function View({ rows }) @{
        <ul>
          @for (const { id, label = id, ...rest } of rows; index index; key id) {
            <li data-id={id}>{index}: {label} / {rest.extra}</li>
          }
        </ul>
      }
    `);
  });

  test("matches destructured catch bindings with defaults and rest", () => {
    compare(`
      export function View() @{
        @try {
          <Broken />
        } @catch (&{ message = "fallback", ...details }, reset) {
          <button onClick={reset}>{message}: {details.name}</button>
        }
      }

      export function PlainView() @{
        @try {
          <Broken />
        } @catch ({ cause: { message } }) {
          <p>{message}</p>
        }
      }

      export function extract(error) {
        try {
          throw error;
        } catch (&[message = "fallback", ...details]) {
          return [message, details];
        }
      }
    `);
  });

  test("matches standalone object and array lazy assignments", () => {
    compare(`
      export function run(source) @{
        &{ value, ...rest } = source;
        &[first, ...tail] = source.items;
        value++;
        return [value, rest, first, tail, source.value];
        <p />
      }
    `);
  });

  test("rejects standalone defaults not accepted by the JavaScript parser", () => {
    const source = `
      export function run(source) @{
        &{ value = 1 } = source;
        return value;
        <p />
      }
    `;
    expect(() => compileBabel(source, options, "lazy-assignment-default.tsrx")).toThrow();
    expect(() => compileOxc(source, "lazy-assignment-default", options, ".tsrx")).toThrow(
      /standalone lazy assignment defaults are not supported/i
    );
  });

  test("matches function/program var scope and nested scope boundaries", () => {
    compare(`
      const programSource = { programValue: "program" };
      if (true) {
        var &{ programValue } = programSource;
      }

      export function run() @{
        const outerSource = { value: "outer" };
        let &{ value } = outerSource;

        function nested(source) {
          if (true) {
            var &{ value } = source;
          }
          return value;
        }

        class Holder {
          static before = value;
          static {
            if (true) {
              var &{ value } = { value: "static" };
            }
            this.inside = value;
          }
          static after = value;
        }

        for (var &{ loopValue } = { loopValue: 0 }; loopValue < 2; loopValue++) {}
        return [programValue, value, nested({ value: "nested" }), Holder, loopValue];
        <p />
      }
    `);
  });

  test("matches loop RHS, lexical shadowing, and for-of var visibility", () => {
    compare(`
      export function run() @{
        const outerSource = { value: 10 };
        let &{ value } = outerSource;

        const classic = { value: 0 };
        const lexicalSeen = [];
        for (let &{ value } = classic; value < 2; value++) {
          lexicalSeen.push(value);
        }

        const rhsSeen = [];
        const iterationSeen = [];
        for (const &{ value } of (rhsSeen.push(value), [{ value: 3 }, { value: 4 }])) {
          iterationSeen.push(value);
        }

        const varSeen = [];
        for (var &{ item } of [{ item: "a" }, { item: "b" }]) {
          varSeen.push(item);
        }
        return [lexicalSeen, rhsSeen, iterationSeen, value, varSeen, item];
        <p />
      }
    `);
  });

  test("terminates cyclic sibling and direct self defaults", () => {
    compare(`
      export function siblings() @{
        const source = {};
        let &{ a = b, b = a } = source;
        return a;
        <p />
      }

      export function self() @{
        const source = {};
        let &{ value = value } = source;
        return value;
        <p />
      }
    `);
  });

  test("uses collision-safe lazy, rest, and temporary names", () => {
    compare(`
      const __lazy0 = 0;
      const __lazyOmit0 = 0;
      const __lazyArray0 = 0;
      const __lazyValue0 = 0;
      export function run() @{
        const source = { value: undefined, other: 2 };
        let &{ value = 1, ...rest } = source;
        const arrayLike = { 0: "a", 1: "b", length: 2 };
        let &[head, ...tail] = arrayLike;
        return [value, rest, head, tail];
        <p />
      }
    `);
  });

  test("rejects writes to lazy rest views", () => {
    const source = `
      export function run() @{
        const source = { value: 1, other: 2 };
        let &{ value, ...rest } = source;
        rest = {};
        <p />
      }
    `;
    expect(() => compileOxc(source, "lazy-rest-write", options, ".tsrx")).toThrow(
      /lazy rest binding is read-only/i
    );
  });

  test("rejects an export-wrapped globalThis for intrinsic Array access", () => {
    const source = `
      export const globalThis = {};
      export function run() @{
        const source = { 0: "a", 1: "b", length: 2 };
        let &[head, ...tail] = source;
        return [head, tail];
        <p />
      }
    `;
    expect(() => compileBabel(source, options, "lazy-array-global.tsrx")).toThrow(
      /cannot safely access the intrinsic Array/i
    );
    expect(() => compileOxc(source, "lazy-array-global", options, ".tsrx")).toThrow(
      /cannot safely access the intrinsic Array/i
    );
  });

  test.each([
    `
      const source = { value: 1 };
      const &{ value } = source;
      export { value };
    `,
    `
      const source = { value: 1 };
      export const &{ value } = source;
    `
  ])("rejects exported lazy bindings", source => {
    expect(() => compileBabel(source, options, "lazy-export.tsrx")).toThrow(
      /lazy bindings cannot be exported/i
    );
    expect(() => compileOxc(source, "lazy-export", options, ".tsrx")).toThrow();
  });

  test.each(["value = 1", "value += 1", "value++", "++value"])(
    "rejects writes below an ancestor default: %s",
    write => {
      const source = `
        export function run() @{
          const source = {};
          let &{ nested: { value } = {} } = source;
          ${write};
          <p />
        }
      `;
      for (const compile of [
        () => compileBabel(source, options, "lazy-ancestor-write.tsrx"),
        () => compileOxc(source, "lazy-ancestor-write", options, ".tsrx")
      ]) {
        expect(compile).toThrow(/nested beneath an ancestor default is read-only/i);
      }
    }
  );
});
