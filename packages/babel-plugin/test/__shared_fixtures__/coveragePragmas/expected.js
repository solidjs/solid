// Shared by the Babel plugin and native compiler tests: the comments each
// export of `code.js` must print ahead of its `children` getters, in order.
const expected = {
  istanbulPragma: ["/* istanbul ignore next */"],
  c8Pragma: ["/* c8 ignore next */"],
  expressionChild: ["/* c8 ignore next */"],
  multipleChildren: ["/* istanbul ignore next */"],
  nestedComponent: ["/* c8 ignore next */"],
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

exports.expectedFor = function expectedFor(generate) {
  // SSR prop hoisting moves a nested component's static props into a shared
  // descriptor, whose `get()` does not carry the getter's comments.
  return generate === "ssr" ? { ...expected, nestedComponent: [] } : expected;
};

const comment = String.raw`\/\*(?:(?!\*\/)[\s\S])*\*\/|\/\/[^\n]*`;
const getterComments = new RegExp(String.raw`((?:(?:${comment})\s*)+)get children\(\)`, "g");

exports.pragmasByExport = function pragmasByExport(code) {
  const result = {};
  const sections = code.split(/^export const (\w+) = /m);
  for (let i = 1; i < sections.length; i += 2) {
    result[sections[i]] = [...sections[i + 1].matchAll(getterComments)].flatMap(([, group]) =>
      group.match(new RegExp(comment, "g")).map(text => text.trim())
    );
  }
  return result;
};
