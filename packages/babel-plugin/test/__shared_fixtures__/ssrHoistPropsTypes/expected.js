// Shared by the Babel plugin and native compiler tests (#3828): a name in a
// TypeScript type position is erased before the code runs, so an SSR props
// constructor must never be handed it as a captured value. Each case lists,
// per `new _P$(…)` in output order, the bindings passed as captures; the
// output is then type-stripped and executed, and must agree with the
// `hoistProps: false` literal form.
const babel = require("@babel/core");
const { stripTypeScriptTypes } = require("node:module");

const components = `const List = (p: any) => p.children;
const Item = (p: any) => [p.v, p.w];
`;

const cases = [
  {
    name: "type parameter in a nested arrow's parameter and return annotations",
    filename: "arrow.tsx",
    source: `${components}
export const C = <Row,>(props: any) => (
  <List>
    <Item v={props.rows} w={(row: Row): Row => props.key(row)} />
  </List>
);
const [rows, key] = C({ rows: [1], key: (r: number) => r + 1 });
__result = [rows, key(1)];`,
    captures: [["props"], ["props"]],
    result: [[1], 2]
  },
  {
    name: "type parameter of a function component in a function expression's annotations",
    filename: "function.tsx",
    source: `${components}
function C<Row>(props: any) {
  return (
    <List>
      <Item
        v={props.v}
        w={function (this: unknown, row: Row): Row {
          return props.key(row);
        }}
      />
    </List>
  );
}
const [v, w] = C({ v: 1, key: (r: number) => r * 3 });
__result = [v, w(2)];`,
    captures: [["props"], ["props"]],
    result: [1, 6]
  },
  {
    name: "as, satisfies and non-null keep the value and drop the type",
    filename: "assertions.tsx",
    source: `${components}
function C<Row>(props: any) {
  return <Item v={(props.v as Row)!} w={props.w satisfies Row} />;
}
__result = C({ v: 1, w: 2 });`,
    captures: [["props"]],
    result: [1, 2]
  },
  {
    name: "generic call and constructor type arguments",
    filename: "type-arguments.tsx",
    source: `${components}
const id = <T,>(v: T) => v;
function C<Row>(props: any) {
  return <Item v={id<Row>(props.v)} w={new Map<string, Row>([["k", props.w]]).get("k")} />;
}
__result = C({ v: 1, w: 2 });`,
    captures: [["props"]],
    result: [1, 2]
  },
  {
    name: "typeof a local value in a type captures neither it nor a reassigned one",
    filename: "typeof.tsx",
    source: `${components}
function C(props: any) {
  let n = props.n;
  n++;
  const m = props.m;
  return <Item v={props.v as typeof n} w={props.w as typeof m} />;
}
__result = C({ n: 1, m: 2, v: 3, w: 4 });`,
    captures: [["props"]],
    result: [3, 4]
  },
  {
    name: "local type alias, interface heritage and class implements",
    filename: "declarations.tsx",
    source: `${components}
function C(props: any) {
  type Row = { v: number };
  interface Keyed extends Row {
    k: number;
  }
  return (
    <Item
      v={(() => {
        interface Local extends Keyed {}
        class K implements Keyed {
          v = props.v;
          k = 0;
        }
        const local: Local = new K();
        return local.v;
      })()}
      w={props.w as Row}
    />
  );
}
__result = C({ v: 1, w: 2 });`,
    captures: [["props"]],
    result: [1, 2]
  },
  {
    name: "type-only imports",
    filename: "imports.tsx",
    source: `import type { Row } from "./types";
import { type Key } from "./types";
${components}
function C(props: any) {
  return <Item v={props.v as Row} w={props.w as Key} />;
}
__result = C({ v: 1, w: 2 });`,
    captures: [["props"]],
    result: [1, 2]
  },
  {
    name: "a name that is both a type and a value captures the value use",
    filename: "type-and-value.tsx",
    source: `${components}
function C(props: any) {
  const Row = (v: number) => v * 2;
  type Row = ReturnType<typeof Row>;
  return <Item v={Row(props.v) as Row} w={props.w as Row} />;
}
__result = C({ v: 1, w: 2 });`,
    captures: [["Row", "props"]],
    result: [2, 2]
  },
  {
    name: "a type declared before a same-named value captures the value use",
    filename: "type-then-value.tsx",
    source: `${components}
function C(props: any) {
  type Row = number;
  const Row = (v: number): Row => v * 2;
  return <Item v={Row(props.v) as Row} w={props.w as Row} />;
}
__result = C({ v: 1, w: 2 });`,
    captures: [["Row", "props"]],
    result: [2, 2]
  },
  {
    name: "a type parameter shadowing a value captures the value use",
    filename: "shadowed.tsx",
    source: `${components}
function C(props: any) {
  const Row = props.factor;
  function Inner<Row>(p: any) {
    return <Item v={p.v as Row} w={p.w * Row} />;
  }
  return Inner(props);
}
__result = C({ factor: 3, v: 1, w: 2 });`,
    captures: [["p", "Row"]],
    result: [1, 6]
  }
];

const ctorName = /^_P\$\d*$/;

/** Per `new _P$(…)` in output order, the arguments bound to `this[_m$…]`. */
function captures(code) {
  const ast = babel.parseSync(code, {
    babelrc: false,
    configFile: false,
    sourceType: "module",
    parserOpts: { plugins: ["typescript"] }
  });
  const slots = new Map();
  const calls = [];
  babel.traverse(ast, {
    FunctionDeclaration(path) {
      const { id, params, body } = path.node;
      if (!id || !ctorName.test(id.name)) return;
      const names = params.map(param => param.name);
      const captured = [];
      for (const statement of body.body) {
        const e = statement.expression;
        if (
          e?.type === "AssignmentExpression" &&
          e.left.type === "MemberExpression" &&
          e.left.computed &&
          e.left.object.type === "ThisExpression" &&
          e.right.type === "Identifier"
        ) {
          captured.push(names.indexOf(e.right.name));
        }
      }
      slots.set(id.name, captured);
    },
    NewExpression(path) {
      const { callee } = path.node;
      if (callee.type === "Identifier" && ctorName.test(callee.name)) calls.push(path.node);
    }
  });
  return calls.map(call =>
    slots.get(call.callee.name).map(index => {
      const arg = call.arguments[index];
      return arg.type === "Identifier" ? arg.name : arg.type;
    })
  );
}

const runtime = {
  ssr: (t, ...v) => ({ t, v }),
  escape: v => v,
  mergeProps: (...sources) => Object.assign({}, ...sources),
  memo: fn => fn,
  createComponent: (Comp, props) => Comp(props)
};

/** Strips the types the way the bundler does after the JSX transform, then runs the module body. */
function run(code) {
  const body = stripTypeScriptTypes(code)
    .replace(/import \{ ([\w$]+) as ([\w$]+) \} from "r-server";/g, "const $2 = __rt.$1;")
    .replace(/^\s*import \{\s*\} from "[^"]+";$/gm, "")
    .replace(/^export /gm, "");
  return new Function("__rt", `let __result;\n${body}\nreturn __result;`)(runtime);
}

/** `compile(source, filename, hoistProps)` returns the compiled code. */
exports.assertCase = function assertCase(testCase, compile) {
  const hoisted = compile(testCase.source, testCase.filename, true);
  expect(captures(hoisted)).toEqual(testCase.captures);
  expect(run(hoisted)).toEqual(testCase.result);
  const literal = compile(testCase.source, testCase.filename, false);
  expect(captures(literal)).toEqual([]);
  expect(run(literal)).toEqual(testCase.result);
};

exports.cases = cases;
