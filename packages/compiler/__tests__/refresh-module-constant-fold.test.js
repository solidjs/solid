// #4791: the refresh pass hoists function-declaration components to the top
// of the module, above the module constants they read. The JSX transform must
// fold such a constant into the template all the same: the server build never
// runs the refresh pass and folds it, so a dev client that kept the hole
// dynamic walked past the end of the server's text node at hydration.

const path = require("path");

const compilerDir = path.resolve(__dirname, "..");
const { transform, transformRefresh } = require(compilerDir);

const base = { hydratable: true, dev: true, filename: "stage.jsx" };
const refresh = { filename: "stage.jsx", bundler: "vite", fixRender: true, jsx: false };
const templates = code => code.match(/_\$template\(`[^`]*`\)/g) ?? [];

describe("a module constant read by a hoisted component (#4791)", () => {
  for (const [name, src] of [
    [
      "plain declaration",
      `const HOST = 'example.com'\n\nexport function Stage() {\n  return <p>crawl · {HOST}</p>\n}\n`
    ],
    [
      "exported constant",
      `export const HOST = 'example.com'\n\nfunction Stage() {\n  return <p>crawl · {HOST}</p>\n}\nexport default Stage\n`
    ],
    [
      "constant from an earlier constant",
      `const A = 'example'\nconst HOST = A + '.com'\n\nexport function Stage() {\n  return <p>crawl · {HOST}</p>\n}\n`
    ]
  ])
    it(`folds as without the refresh pass (${name})`, () => {
      const plain = transform(src, { ...base, generate: "dom" }).code;
      const refreshed = transform(transformRefresh(src, refresh).code, {
        ...base,
        generate: "dom"
      }).code;
      expect(templates(plain)).toEqual(["_$template(`<p>crawl · example.com`)"]);
      expect(templates(refreshed)).toEqual(templates(plain));
      expect(refreshed).not.toContain("_$insert(");
    });

  it("a reassigned binding stays dynamic", () => {
    const src = `let HOST = 'example.com'\nHOST = 'other'\n\nexport function Stage() {\n  return <p>crawl · {HOST}</p>\n}\n`;
    const refreshed = transform(transformRefresh(src, refresh).code, {
      ...base,
      generate: "dom"
    }).code;
    expect(refreshed).toContain("_$insert(");
  });

  it("a local of the same name still wins inside the component", () => {
    const src = `const HOST = 'example.com'\n\nexport function Stage(props) {\n  const HOST = props.host;\n  return <p>crawl · {HOST}</p>\n}\n`;
    const refreshed = transform(transformRefresh(src, refresh).code, {
      ...base,
      generate: "dom"
    }).code;
    expect(refreshed).toContain("_$insert(");
  });
});
