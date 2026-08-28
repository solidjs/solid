// Shared harness for Babel vs Oxc compiler parity checking.
//
// Compiles Babel fixture sources with BOTH compilers under identical options
// and normalizes cosmetic output differences (declarator joining, arrow body
// form, IIFE wrapping, DOM walk-chain caching, comments, generated identifier
// numbering, import order/aliasing, string/template escaping) so that any
// remaining diff is a real semantic divergence.
//
// Used by the `parity.test.js` ratchet suite and `scripts/parity-diff.mjs`.

const fs = require("fs");
const path = require("path");
const { createRequire } = require("module");

const compilerDir = path.resolve(__dirname, "../..");
const babelPkgDir = path.resolve(compilerDir, "../babel-plugin");
const babelTestDir = path.join(babelPkgDir, "test");

const requireBabelPkg = createRequire(path.join(babelPkgDir, "package.json"));
const babel = requireBabelPkg("@babel/core");
const babelPlugin = requireBabelPkg(babelPkgDir);
const { transform: oxcTransform } = require(compilerDir);
const t = babel.types;

const domElements = [
  "table",
  "tbody",
  "div",
  "h1",
  "span",
  "header",
  "footer",
  "slot",
  "my-el",
  "my-element",
  "module",
  "input",
  "img",
  "iframe",
  "button",
  "a",
  "svg",
  "rect",
  "x",
  "y",
  "linearGradient",
  "stop",
  "style",
  "li",
  "ul",
  "label",
  "text",
  "namespace:tag",
  "path",
  "noscript",
  "select",
  "option",
  "video"
];

// Option sets mirror the per-mode suites in packages/babel-plugin/test/
// and packages/compiler/__tests__/. Fixtures are discovered from the
// Babel fixture directories so new fixtures automatically join the parity
// suite.
const modes = {
  dom: {
    fixtureDir: "__dom_fixtures__",
    options: {
      moduleName: "r-dom",
      builtIns: ["For", "Show"],
      wrapConditionals: true,
      contextToCustomElements: true,
      requireImportSource: false
    }
  },
  // Classic-output parity: patch mode is DEFAULT-ON, so the plain `dom`
  // mode covers the patch grammar; this tier fences the EXPLICIT OPT-OUT
  // (patchDriver: false) — fully classic output must stay byte-identical
  // across backends too.
  "dom-nopatch": {
    fixtureDir: "__dom_fixtures__",
    options: {
      moduleName: "r-dom",
      builtIns: ["For", "Show"],
      wrapConditionals: true,
      contextToCustomElements: true,
      requireImportSource: false,
      patchDriver: false
    }
  },
  "dom-hydratable": {
    fixtureDir: "__dom_hydratable_fixtures__",
    options: {
      moduleName: "r-dom",
      builtIns: ["For", "Show"],
      hydratable: true,
      contextToCustomElements: true
    }
  },
  "dom-hydratable-dev": {
    fixtureDir: "__dom_hydratable_dev_fixtures__",
    options: {
      moduleName: "r-dom",
      builtIns: ["For", "Show"],
      hydratable: true,
      dev: true,
      contextToCustomElements: true
    }
  },
  "dom-no-inline-styles": {
    fixtureDir: "__dom_no_inline_styles_fixtures__",
    options: {
      moduleName: "r-dom",
      builtIns: ["For", "Show"],
      wrapConditionals: true,
      contextToCustomElements: true,
      requireImportSource: false,
      inlineStyles: false
    }
  },
  "dom-wrapperless": {
    fixtureDir: "__dom_wrapperless_fixtures__",
    options: {
      moduleName: "r-dom",
      builtIns: ["For", "Show"],
      wrapConditionals: false,
      delegateEvents: false,
      effectWrapper: false,
      memoWrapper: false,
      contextToCustomElements: true
    }
  },
  ssr: {
    fixtureDir: "__ssr_fixtures__",
    options: {
      moduleName: "r-server",
      builtIns: ["For", "Show"],
      generate: "ssr",
      wrapConditionals: true,
      contextToCustomElements: true,
      requireImportSource: false
    }
  },
  "ssr-hydratable": {
    fixtureDir: "__ssr_hydratable_fixtures__",
    options: {
      moduleName: "r-server",
      builtIns: ["For", "Show"],
      generate: "ssr",
      hydratable: true,
      contextToCustomElements: true
    }
  },
  universal: {
    fixtureDir: "__universal_fixtures__",
    options: {
      moduleName: "r-custom",
      builtIns: ["For", "Show"],
      generate: "universal"
    }
  },
  "dynamic-universal": {
    fixtureDir: "__universal_fixtures__",
    options: {
      moduleName: "r-custom",
      builtIns: ["For", "Show"],
      generate: "dynamic"
    }
  },
  dynamic: {
    fixtureDir: "__dynamic_fixtures__",
    options: {
      moduleName: "r-custom",
      builtIns: ["For", "Show"],
      generate: "dynamic",
      contextToCustomElements: true,
      wrapConditionals: true,
      renderers: [{ name: "dom", moduleName: "r-dom", elements: domElements }]
    }
  }
};

function fixtureNames(mode) {
  const dir = path.join(babelTestDir, modes[mode].fixtureDir);
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .filter(entry => fs.existsSync(path.join(dir, entry.name, "code.js")))
    .map(entry => entry.name)
    .sort();
}

function readFixtureSource(mode, fixture) {
  const source = fs.readFileSync(
    path.join(babelTestDir, modes[mode].fixtureDir, fixture, "code.js"),
    "utf8"
  );
  return supportedSubset(mode, fixture, source);
}

// Same parser-blocked subset carve-out as babel-fixtures.test.js: Oxc cannot
// parse hyphenated JSX member segments (`<module.a-b />`).
function supportedSubset(mode, fixture, source) {
  if ((mode === "dom" || mode === "dom-nopatch") && fixture === "namespaceElements") {
    return [
      source.slice(source.indexOf("const template ="), source.indexOf("const template4")),
      source.slice(source.indexOf("const template6"))
    ].join("\n");
  }
  return source;
}

function compileBabel(code, options) {
  // Patch mode is DEFAULT-ON in both compilers (the dom modes cover the
  // patch grammar); dom-nopatch fences the explicit opt-out.
  return babel.transformSync(code, {
    babelrc: false,
    configFile: false,
    plugins: [[babelPlugin, options]],
    parserOpts: { plugins: ["jsx"] }
  }).code;
}

function compileOxc(code, fixture, options) {
  return oxcTransform(code, { filename: `${fixture}.jsx`, ...options }).code;
}

// --- Normalization ---------------------------------------------------------

// Pass 1: split joined declarators, unwrap setup IIFEs, flatten naked blocks.
// Babel hoists element setup to statements where Oxc wraps an IIFE (and vice
// versa in some positions); neither is semantic.
const structuralPlugin = () => ({
  visitor: {
    VariableDeclaration(p) {
      if (p.node.declarations.length <= 1) return;
      if (!p.parentPath.isBlockStatement() && !p.parentPath.isProgram()) return;
      p.replaceWithMultiple(p.node.declarations.map(d => t.variableDeclaration(p.node.kind, [d])));
    },
    BlockStatement(p) {
      if (p.parentPath.isBlockStatement() || p.parentPath.isProgram()) {
        p.replaceWithMultiple(p.node.body);
      }
    },
    VariableDeclarator(p) {
      const init = p.get("init");
      if (!init.isCallExpression() || init.node.arguments.length !== 0) return;
      const callee = init.get("callee");
      if (!callee.isArrowFunctionExpression() || callee.node.params.length !== 0) return;
      const body = callee.get("body");
      if (!body.isBlockStatement()) return;
      const stmts = body.node.body;
      const last = stmts[stmts.length - 1];
      if (!last || last.type !== "ReturnStatement" || !last.argument) return;
      const declaration = p.parentPath;
      if (
        declaration.node.declarations.length !== 1 ||
        (!declaration.parentPath.isProgram() && !declaration.parentPath.isBlockStatement())
      )
        return;
      declaration.insertBefore(stmts.slice(0, -1));
      init.replaceWith(last.argument);
    }
  }
});

// Pass 2: inline chained DOM walk variables to full root-based paths and drop
// the walk variables. Babel chains through cached intermediate vars, Oxc
// re-derives from the root; the traversal result is identical.
const WALK_PROPS = new Set([
  "firstChild",
  "nextSibling",
  "lastChild",
  "previousSibling",
  "content"
]);

function walkBase(expr) {
  let node = expr;
  while (
    node.type === "MemberExpression" &&
    !node.computed &&
    node.property.type === "Identifier" &&
    WALK_PROPS.has(node.property.name)
  ) {
    node = node.object;
  }
  return node !== expr && node.type === "Identifier" ? node.name : null;
}

const walkInlinePlugin = () => ({
  visitor: {
    Program(p) {
      const decls = new Map();
      p.traverse({
        VariableDeclarator(dp) {
          if (dp.node.id.type !== "Identifier" || !dp.node.init) return;
          if (walkBase(dp.node.init)) decls.set(dp.node.id.name, dp);
        }
      });
      const resolve = (name, seen = new Set()) => {
        const dp = decls.get(name);
        if (!dp || seen.has(name)) return null;
        seen.add(name);
        const init = t.cloneNode(dp.node.init, true);
        const base = walkBase(init);
        const replacement = resolve(base, seen);
        if (replacement) {
          let node = init;
          while (node.object.type === "MemberExpression") node = node.object;
          node.object = replacement;
        }
        return init;
      };
      for (const [name, dp] of decls) {
        const inlined = resolve(name);
        if (inlined) dp.node.init = inlined;
      }
      p.scope.crawl();
      for (const [name, dp] of decls) {
        const binding = p.scope.getBinding(name);
        if (!binding) continue;
        for (const ref of binding.referencePaths) {
          ref.replaceWith(t.cloneNode(dp.node.init, true));
        }
        dp.parentPath.remove();
      }
    }
  }
});

// Pass 3: expression-level cosmetics.
const normalizePlugin = () => ({
  visitor: {
    // Canonicalize arrow bodies: `() => expr` -> `() => { return expr; }`.
    ArrowFunctionExpression(p) {
      if (p.node.body.type !== "BlockStatement") {
        p.node.body = t.blockStatement([t.returnStatement(p.node.body)]);
      }
    },
    // Canonicalize template raw text (`\{` vs `{` are identical cooked) and
    // collapse substitution-free template literals to plain strings.
    TemplateLiteral(p) {
      if (
        p.node.expressions.length === 0 &&
        p.node.quasis.length === 1 &&
        !p.parentPath.isTaggedTemplateExpression()
      ) {
        const cooked = p.node.quasis[0].value.cooked;
        if (cooked != null) {
          p.replaceWith(t.stringLiteral(cooked));
          return;
        }
      }
      for (const quasi of p.node.quasis) {
        const cooked = quasi.value.cooked;
        if (cooked == null) continue;
        quasi.value.raw = cooked
          .replace(/\\/g, "\\\\")
          .replace(/`/g, "\\`")
          .replace(/\$\{/g, "\\${");
      }
    },
    // Drop raw so `.4`/`0.4` and quote styles print canonically.
    NumericLiteral(p) {
      p.node.extra = null;
    },
    StringLiteral(p) {
      p.node.extra = null;
    },
    // `{ "for": x }` vs `{ for: x }` and `{ children: children }` vs
    // shorthand are cosmetic.
    ObjectProperty(p) {
      const key = p.node.key;
      if (
        !p.node.computed &&
        key.type === "StringLiteral" &&
        /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key.value)
      ) {
        p.node.key = t.identifier(key.value);
      }
      p.node.shorthand = false;
    },
    Program: {
      exit(p) {
        const body = p.node.body;
        let end = 0;
        while (end < body.length && body[end].type === "ImportDeclaration") end++;
        // Canonicalize helper import aliases (_$createComponent vs
        // _$createComponent2) by imported name + source, then sort imports;
        // neither is semantic.
        for (const stmtPath of p.get("body").slice(0, end)) {
          for (const spec of stmtPath.get("specifiers")) {
            if (!spec.isImportSpecifier()) continue;
            const imported = spec.node.imported.name || spec.node.imported.value;
            const source = stmtPath.node.source.value;
            const canonical = `_\$${imported}__${source.replace(/[^A-Za-z0-9]/g, "_")}`;
            if (spec.node.local.name !== canonical) {
              stmtPath.scope.rename(spec.node.local.name, canonical);
            }
          }
        }
        const imports = body.slice(0, end);
        imports.sort((a, b) => {
          const key = n =>
            `${n.source.value}|${n.specifiers.map(s => s.imported?.name || s.local.name).join(",")}`;
          return key(a) < key(b) ? -1 : 1;
        });
        p.node.body = [...imports, ...body.slice(end)];

        // Inline hoisted single-init string constants (SSR template strings):
        // `var _tmpl$ = "<div>"; ssr(_tmpl$)` vs inline `ssr("<div>")` differ
        // only in hoisting.
        p.scope.crawl();
        for (const stmtPath of p.get("body")) {
          if (!stmtPath.isVariableDeclaration()) continue;
          for (const decl of stmtPath.get("declarations")) {
            const init = decl.get("init");
            const id = decl.node.id;
            if (!init.isStringLiteral() || id.type !== "Identifier") continue;
            const binding = p.scope.getBinding(id.name);
            if (!binding || !binding.constant) continue;
            for (const ref of binding.referencePaths) {
              ref.replaceWith(t.stringLiteral(init.node.value));
            }
            decl.remove();
          }
        }
      }
    }
  }
});

function runPass(code, plugin) {
  return babel.transformSync(code, {
    babelrc: false,
    configFile: false,
    plugins: [plugin],
    parserOpts: { plugins: ["jsx"] },
    comments: false,
    compact: false
  }).code;
}

// Rename generated identifiers (_el$3, _tmpl$2, _v$, _c$, _ref$, _p$ ...) to
// sequential names by order of first appearance so numbering and param-name
// choices don't obscure diffs. Import aliases like _$template are untouched
// (already canonicalized by imported name).
function canonicalizeGeneratedNames(code) {
  const re = /_[A-Za-z]+\$\d*/g;
  const mapping = new Map();
  let counter = 0;
  return code.replace(re, name => {
    if (!mapping.has(name)) mapping.set(name, `_g${++counter}$`);
    return mapping.get(name);
  });
}

function normalize(code) {
  let out = runPass(code, structuralPlugin);
  out = runPass(out, walkInlinePlugin);
  out = runPass(out, normalizePlugin);
  return canonicalizeGeneratedNames(out);
}

// --- Comparison -------------------------------------------------------------

// Compiles a fixture with both compilers and returns normalized outputs plus
// raw outputs. Throws with a labeled error if either compiler rejects input.
function compareFixture(mode, fixture) {
  const { options } = modes[mode];
  const source = readFixtureSource(mode, fixture);
  let babelRaw, oxcRaw;
  try {
    babelRaw = compileBabel(source, options);
  } catch (err) {
    throw new Error(`babel-plugin failed on ${mode}/${fixture}: ${err.message}`);
  }
  try {
    oxcRaw = compileOxc(source, fixture, options);
  } catch (err) {
    throw new Error(`compiler failed on ${mode}/${fixture}: ${err.message}`);
  }
  return {
    babelRaw,
    oxcRaw,
    babel: normalize(babelRaw),
    oxc: normalize(oxcRaw)
  };
}

// --- Diffing ----------------------------------------------------------------

// Line-level LCS with common prefix/suffix trimming; emits a unified diff
// without file headers or timestamps so ratchet files stay stable.
function unifiedDiff(aText, bText, context = 3) {
  const a = aText.split("\n");
  const b = bText.split("\n");

  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }

  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  const n = midA.length;
  const m = midB.length;

  // LCS length table (DP). Sizes here are a few thousand lines at most.
  const width = m + 1;
  const table = new Int32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i * width + j] =
        midA[i] === midB[j]
          ? table[(i + 1) * width + j + 1] + 1
          : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
    }
  }

  // Backtrack into an edit script over the full inputs.
  const ops = []; // { type: " " | "-" | "+", line }
  for (let k = 0; k < start; k++) ops.push({ type: " ", line: a[k] });
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (midA[i] === midB[j]) {
      ops.push({ type: " ", line: midA[i] });
      i++;
      j++;
    } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) {
      ops.push({ type: "-", line: midA[i] });
      i++;
    } else {
      ops.push({ type: "+", line: midB[j] });
      j++;
    }
  }
  while (i < n) ops.push({ type: "-", line: midA[i++] });
  while (j < m) ops.push({ type: "+", line: midB[j++] });
  for (let k = endA; k < a.length; k++) ops.push({ type: " ", line: a[k] });

  // Group into hunks with `context` lines of context.
  const hunks = [];
  let hunk = null;
  let aLine = 1;
  let bLine = 1;
  let trailing = 0;
  for (let k = 0; k < ops.length; k++) {
    const op = ops[k];
    if (op.type === " ") {
      if (hunk) {
        if (trailing < context) {
          hunk.lines.push(" " + op.line);
          hunk.aCount++;
          hunk.bCount++;
          trailing++;
        } else {
          // Close the hunk unless another change is within 2*context lines.
          let upcoming = false;
          for (let l = k; l < Math.min(ops.length, k + context + 1); l++) {
            if (ops[l].type !== " ") {
              upcoming = true;
              break;
            }
          }
          if (upcoming) {
            hunk.lines.push(" " + op.line);
            hunk.aCount++;
            hunk.bCount++;
          } else {
            hunks.push(hunk);
            hunk = null;
          }
        }
      }
      aLine++;
      bLine++;
    } else {
      if (!hunk) {
        const lead = [];
        for (let l = Math.max(0, k - context); l < k; l++) {
          lead.push(" " + ops[l].line);
        }
        hunk = {
          aStart: aLine - lead.length,
          bStart: bLine - lead.length,
          aCount: lead.length,
          bCount: lead.length,
          lines: lead
        };
      }
      trailing = 0;
      hunk.lines.push(op.type + op.line);
      if (op.type === "-") {
        hunk.aCount++;
        aLine++;
      } else {
        hunk.bCount++;
        bLine++;
      }
    }
  }
  if (hunk) hunks.push(hunk);

  if (hunks.length === 0) return "";
  return (
    hunks
      .map(h => `@@ -${h.aStart},${h.aCount} +${h.bStart},${h.bCount} @@\n` + h.lines.join("\n"))
      .join("\n") + "\n"
  );
}

module.exports = {
  modes,
  fixtureNames,
  readFixtureSource,
  compileBabel,
  compileOxc,
  normalize,
  compareFixture,
  unifiedDiff
};
