const babel = require("@babel/core");
const plugin = require("../index");

function compile(code) {
  return babel.transformSync(code, {
    babelrc: false,
    configFile: false,
    filename: "lazy.tsrx",
    plugins: [[plugin, { generate: "dom" }]]
  }).code;
}

function execute(code) {
  return Function(`${compile(code)}\nreturn result;`)();
}

describe("TSRX lazy destructuring", () => {
  test("defaults use undefined semantics and updates write the defaulted value", () => {
    const result = execute(`
      let backing;
      let reads = 0;
      let writes = 0;
      let fallbacks = 0;
      const source = {
        get value() {
          reads++;
          return backing;
        },
        set value(next) {
          writes++;
          backing = next;
        }
      };
      let &{ value = ++fallbacks } = source;

      const first = value;
      const post = value++;
      const pre = ++value;
      value = undefined;
      const compound = value += 5;
      source.value = null;
      const nullValue = value;

      const result = {
        first,
        post,
        pre,
        compound,
        nullValue,
        backing,
        reads,
        writes,
        fallbacks
      };
    `);

    expect(result).toEqual({
      first: 1,
      post: 2,
      pre: 4,
      compound: 8,
      nullValue: null,
      backing: null,
      reads: 5,
      writes: 5,
      fallbacks: 3
    });
  });

  test("nested and computed defaults stay lazy and evaluate each member once", () => {
    const result = execute(`
      let keyReads = 0;
      let fallbackReads = 0;
      let backing;
      const source = {
        nested: {
          get value() {
            keyReads++;
            return backing;
          },
          set value(next) {
            backing = next;
          }
        }
      };
      let &{
        nested: &{
          ["value"]: renamed = ++fallbackReads
        }
      } = source;

      const first = renamed;
      const post = renamed++;
      const result = {
        first,
        post,
        current: source.nested.value,
        keyReads,
        fallbackReads
      };
    `);

    expect(result).toEqual({
      first: 1,
      post: 2,
      current: 3,
      keyReads: 3,
      fallbackReads: 2
    });
  });

  test("array rest creates a fresh Array.from slice for every read", () => {
    const result = execute(`
      const arrayLike = { 0: "a", 1: "b", 2: "c", length: 3 };
      let &[head, ...tail] = arrayLike;

      let iterations = 0;
      const iterable = {
        *[Symbol.iterator]() {
          iterations++;
          yield 1;
          yield 2;
          yield 3;
        }
      };
      let &[first, ...remaining] = iterable;

      const result = {
        head,
        tailA: tail,
        tailB: tail,
        first,
        remainingA: remaining,
        remainingB: remaining,
        iterations
      };
    `);

    expect(result).toEqual({
      head: "a",
      tailA: ["b", "c"],
      tailB: ["b", "c"],
      // Non-rest lazy array elements preserve TSRX's indexed-read semantics;
      // only the rest view consumes generic iterables.
      first: undefined,
      remainingA: [2, 3],
      remainingB: [2, 3],
      iterations: 2
    });
    expect(result.tailA).not.toBe(result.tailB);
    expect(result.remainingA).not.toBe(result.remainingB);
  });

  test("object rest lowers to a collision-safe reactive omit call", () => {
    const output = compile(`
      const __lazy0 = 0;
      const __lazyOmit0 = 0;
      const source = { selected: 1, other: 2 };
      let &{ selected, ...rest } = source;
      const result = [selected, rest];
    `);

    expect(output).toContain('import { omit as __lazyOmit1 } from "solid-js"');
    expect(output).toContain("let __lazy1 = source");
    expect(output).toContain('__lazyOmit1(__lazy1, "selected")');
  });

  test("function names and parameters shadow outer lazy bindings", () => {
    const result = execute(`
      const source = { value: 42 };
      let &{ value } = source;
      const named = function value(param = value) {
        return param;
      };
      const parameter = (value = value) => value;
      let parameterThrew = false;
      try {
        parameter();
      } catch (error) {
        parameterThrew = error instanceof ReferenceError;
      }
      const result = {
        namedUsesItself: named() === named,
        parameterThrew,
        outer: value
      };
    `);

    expect(result).toEqual({
      namedUsesItself: true,
      parameterThrew: true,
      outer: 42
    });
  });

  test("var lazy bindings remain visible across their function and program scope", () => {
    const result = execute(`
      const programSource = { programValue: "program" };
      if (true) {
        var &{ programValue } = programSource;
      }

      function fromBlock(source) {
        if (true) {
          var &{ value } = source;
        }
        return value;
      }

      function fromLoop(source) {
        for (var &{ value } = source; value < 3; value++) {}
        return value;
      }

      const result = {
        programValue,
        block: fromBlock({ value: 2 }),
        loop: fromLoop({ value: 0 })
      };
    `);

    expect(result).toEqual({
      programValue: "program",
      block: 2,
      loop: 3
    });
  });

  test("var collection stops at nested function, class, and static-block boundaries", () => {
    const result = execute(`
      const outerSource = { value: "outer" };
      let &{ value } = outerSource;

      function nested() {
        if (true) {
          var &{ value } = { value: "function" };
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

      const result = {
        outer: value,
        nested: nested(),
        before: Holder.before,
        inside: Holder.inside,
        after: Holder.after
      };
    `);

    expect(result).toEqual({
      outer: "outer",
      nested: "function",
      before: "outer",
      inside: "static",
      after: "outer"
    });
  });

  test("loop scopes preserve iteration, shadowing, and post-loop var visibility", () => {
    const result = execute(`
      const outerSource = { value: 10 };
      let &{ value } = outerSource;

      const classic = { value: 0 };
      const lexicalSeen = [];
      for (let &{ value } = classic; value < 2; value++) {
        lexicalSeen.push(value);
      }

      const iterationSeen = [];
      for (const &{ value } of [{ value: 3 }, { value: 4 }]) {
        iterationSeen.push(value);
      }

      const varSeen = [];
      for (var &{ item } of [{ item: "a" }, { item: "b" }]) {
        varSeen.push(item);
      }

      const result = {
        lexicalSeen,
        classicValue: classic.value,
        iterationSeen,
        outerAfterLoops: value,
        varSeen,
        itemAfterLoop: item
      };
    `);

    expect(result).toEqual({
      lexicalSeen: [0, 1],
      classicValue: 2,
      iterationSeen: [3, 4],
      outerAfterLoops: 10,
      varSeen: ["a", "b"],
      itemAfterLoop: "b"
    });
  });

  test("for-of lexical lazy bindings are in the RHS temporal dead zone", () => {
    expect(() =>
      execute(`
        const outerSource = { value: 10 };
        let &{ value } = outerSource;
        for (const &{ value } of (value, [])) {}
        const result = value;
      `)
    ).toThrow(ReferenceError);
  });

  test("defaulted component names lower through Dynamic", () => {
    const output = compile(`
      function View(&{ Component = "div" }) @{
        <Component title="ok" />
      }
    `);

    expect(output).toContain("Dynamic");
    expect(output).toContain("get component()");
    expect(output).toContain("=== void 0");
  });

  test("embedded defaults and computed keys recursively read lazy bindings", () => {
    const result = execute(`
      const source = {};
      let &{ a = 1, b = a } = source;

      let keyReads = 0;
      const outer = {
        get key() {
          keyReads++;
          return "target";
        }
      };
      let &{ key } = outer;
      const computed = { target: undefined };
      let &{ [key]: value = key } = computed;

      const result = {
        a,
        b,
        first: value,
        second: value,
        keyReads
      };
    `);

    expect(result).toEqual({
      a: 1,
      b: 1,
      first: "target",
      second: "target",
      keyReads: 4
    });
  });

  test("export-wrapped globalThis bindings reject lazy array rest", () => {
    expect(() =>
      compile(`
        export const globalThis = {};
        const source = { 0: "a", 1: "b", length: 2 };
        let &[head, ...tail] = source;
      `)
    ).toThrow(/cannot safely access the intrinsic Array/i);
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
  ])("rejects exporting lazy bindings", source => {
    expect(() => compile(source)).toThrow(/lazy bindings cannot be exported/i);
  });

  test.each(["value = 1", "value += 1", "value++", "++value"])(
    "writes below an ancestor default fail: %s",
    write => {
      expect(() =>
        compile(`
          const source = {};
          let &{ nested: { value } = {} } = source;
          ${write};
        `)
      ).toThrow(/nested beneath an ancestor default is read-only/i);
    }
  );

  test("writes to rest bindings fail with a focused diagnostic", () => {
    expect(() =>
      compile(`
        const source = { selected: 1, other: 2 };
        let &{ selected, ...rest } = source;
        rest = {};
      `)
    ).toThrow(/lazy rest binding is read-only/i);
  });
});
