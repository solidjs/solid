// Shared by the Babel plugin and native compiler tests: the comments each
// export of `code.js` must print ahead of its `children` getters (or, after
// SSR prop hoisting, the shared descriptor's `get()`), in order.
const expected = {
  istanbulPragma: ["/* istanbul ignore next */"],
  c8Pragma: ["/* c8 ignore next */"],
  expressionChild: ["/* c8 ignore next */"],
  multipleChildren: ["/* istanbul ignore next */"],
  nestedComponent: ["/* c8 ignore next */"],
  beforeComponent: ["/* istanbul ignore next */"],
  fragmentPragma: ["/* c8 ignore next */"],
  fragmentBeforeComponent: ["/* istanbul ignore next */"],
  twoContainers: ["/* istanbul ignore next */", "/* c8 ignore next */"],
  noteBesidePragma: ["/* c8 ignore next */"],
  textAfterPragma: ["/* c8 ignore next */"],
  spaceAfterPragma: ["/* c8 ignore next */"],
  lineComment: [],
  lineCommentMentioningBlock: [],
  blockCommentMentioningLine: [],
  trailingPragma: [],
  notePragmaOnly: [],
  lookalike: []
};

exports.expectedFor = function expectedFor(_generate) {
  return expected;
};

const comment = String.raw`\/\*(?:(?!\*\/)[\s\S])*\*\/|\/\/[^\n]*`;
// `get children()` in place, or the SSR-hoisted descriptor's bare `get()`.
const getterComments = new RegExp(String.raw`((?:(?:${comment})\s*)+)get(?: children)?\(\)`, "g");

function commentsIn(group) {
  return group.match(new RegExp(comment, "g")).map(text => text.trim());
}

exports.pragmasByExport = function pragmasByExport(code) {
  // SSR hoist lifts getters into module-level `_d$` descriptors referenced by
  // `_P$` constructors; attribute those children-descriptor comments to the
  // export that constructs them.
  const descriptorComments = Object.create(null);
  const descRe = new RegExp(
    String.raw`\b(_d\$\d*)\s*=\s*\{\s*((?:(?:${comment})\s*)*)get\(`,
    "g"
  );
  for (const match of code.matchAll(descRe)) {
    descriptorComments[match[1]] = match[2] ? commentsIn(match[2]) : [];
  }

  const ctorChildrenDesc = Object.create(null);
  const ctorRe = /function\s+(_P\$\d*)\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/g;
  for (const match of code.matchAll(ctorRe)) {
    const childDef = match[2].match(
      /Object\.defineProperty\(\s*this\s*,\s*"children"\s*,\s*(_d\$\d*)\s*\)/
    );
    if (childDef) ctorChildrenDesc[match[1]] = childDef[1];
  }

  const result = {};
  const sections = code.split(/^export const (\w+) = /m);
  for (let i = 1; i < sections.length; i += 2) {
    const body = sections[i + 1];
    const fromGetters = [...body.matchAll(getterComments)].flatMap(([, group]) =>
      commentsIn(group)
    );
    const fromHoist = [];
    for (const match of body.matchAll(/new\s+(_P\$\d*)\s*\(/g)) {
      const desc = ctorChildrenDesc[match[1]];
      if (desc && descriptorComments[desc]?.length) {
        fromHoist.push(...descriptorComments[desc]);
      }
    }
    result[sections[i]] = [...fromGetters, ...fromHoist];
  }
  return result;
};
