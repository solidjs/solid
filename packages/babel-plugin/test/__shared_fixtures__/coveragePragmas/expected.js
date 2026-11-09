// Shared by the Babel plugin and native compiler tests: which coverage
// pragmas lead which component's `children` getter (or, after SSR prop
// hoisting, that component's shared descriptor `get()`).
const expected = {
  istanbulPragma: { Show: ["/* istanbul ignore next */"] },
  c8Pragma: { Show: ["/* c8 ignore next */"] },
  expressionChild: { Show: ["/* c8 ignore next */"] },
  multipleChildren: { Comp: ["/* istanbul ignore next */"] },
  nestedComponent: { Inner: ["/* c8 ignore next */"] },
  // Hand-off: pragma sits on Match's getter, not Switch's (#2138 / #4701).
  beforeComponent: { Match: ["/* istanbul ignore next */"] },
  fragmentPragma: { Comp: ["/* c8 ignore next */"] },
  fragmentBeforeComponent: { Match: ["/* istanbul ignore next */"] },
  twoContainers: { Comp: ["/* istanbul ignore next */", "/* c8 ignore next */"] },
  noteBesidePragma: { Comp: ["/* c8 ignore next */"] },
  textAfterPragma: { Comp: ["/* c8 ignore next */"] },
  spaceAfterPragma: { Comp: ["/* c8 ignore next */"] },
  lineComment: {},
  lineCommentMentioningBlock: {},
  blockCommentMentioningLine: {},
  trailingPragma: {},
  notePragmaOnly: {},
  lookalike: {},
  // Child has no children getter → fall back to Parent (#4701).
  beforeComponentNoGetter: { Parent: ["/* istanbul ignore next */"] },
  beforeComponentStaticText: { Parent: ["/* istanbul ignore next */"] },
  fragmentBeforeComponentNoGetter: { Parent: ["/* istanbul ignore next */"] },
  // Incoming + own both lead Child's getter (#4701).
  stackedBeforeAndOwn: {
    Child: ["/* istanbul ignore next */", "/* c8 ignore next */"]
  }
};

exports.expectedFor = function expectedFor(_generate) {
  return expected;
};

const comment = String.raw`\/\*(?:(?!\*\/)[\s\S])*\*\/|\/\/[^\n]*`;
const commentRe = new RegExp(comment, "g");
const leadingCommentsThenGetChildren = new RegExp(
  String.raw`((?:(?:${comment})\s*)*)get children\(\)`,
  "y"
);
const leadingCommentsThenBareGet = new RegExp(String.raw`((?:(?:${comment})\s*)*)get\(`, "y");

function commentsIn(group) {
  if (!group) return [];
  return group.match(commentRe)?.map(text => text.trim()) ?? [];
}

function emptyToUndefined(map) {
  const out = {};
  for (const [key, value] of Object.entries(map)) {
    if (value.length) out[key] = value;
  }
  return out;
}

/** Babel/helper import locals are `_$Show`; normalize to `Show`. */
function normalizeTag(tag) {
  return tag.replace(/^_\$/, "");
}

function skipString(source, start) {
  const quote = source[start];
  let i = start + 1;
  while (i < source.length) {
    if (source[i] === "\\") {
      i += 2;
      continue;
    }
    if (source[i] === quote) return i + 1;
    i++;
  }
  return source.length;
}

function skipLineComment(source, start) {
  let i = start + 2;
  while (i < source.length && source[i] !== "\n") i++;
  return i;
}

function skipBlockComment(source, start) {
  let i = start + 2;
  while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) i++;
  return Math.min(i + 2, source.length);
}

function propsObjectSlice(source, afterOpenBrace) {
  let depth = 1;
  for (let i = afterOpenBrace; i < source.length; i++) {
    const ch = source[i];
    if (ch === '"' || ch === "'" || ch === "`") i = skipString(source, i) - 1;
    else if (ch === "/" && source[i + 1] === "*") i = skipBlockComment(source, i) - 1;
    else if (ch === "/" && source[i + 1] === "/") i = skipLineComment(source, i) - 1;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return source.slice(afterOpenBrace, i);
    }
  }
  return null;
}

/**
 * Comments on the props object's own `get children()` — not nested getters
 * inside that method's body.
 */
function topLevelChildrenGetterComments(props) {
  let depth = 0;
  for (let i = 0; i < props.length; i++) {
    const ch = props[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      i = skipString(props, i) - 1;
      continue;
    }
    if (ch === "/" && props[i + 1] === "*") {
      if (depth === 0) {
        leadingCommentsThenGetChildren.lastIndex = i;
        const match = leadingCommentsThenGetChildren.exec(props);
        if (match) return commentsIn(match[1]);
      }
      i = skipBlockComment(props, i) - 1;
      continue;
    }
    if (ch === "/" && props[i + 1] === "/") {
      i = skipLineComment(props, i) - 1;
      continue;
    }
    if (depth === 0) {
      leadingCommentsThenGetChildren.lastIndex = i;
      const match = leadingCommentsThenGetChildren.exec(props);
      if (match && match.index === i) return commentsIn(match[1]);
    }
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
  }
  return [];
}

function topLevelBareGetComments(props) {
  let depth = 0;
  for (let i = 0; i < props.length; i++) {
    const ch = props[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      i = skipString(props, i) - 1;
      continue;
    }
    if (ch === "/" && props[i + 1] === "*") {
      if (depth === 0) {
        leadingCommentsThenBareGet.lastIndex = i;
        const match = leadingCommentsThenBareGet.exec(props);
        if (match) return commentsIn(match[1]);
      }
      i = skipBlockComment(props, i) - 1;
      continue;
    }
    if (ch === "/" && props[i + 1] === "/") {
      i = skipLineComment(props, i) - 1;
      continue;
    }
    if (depth === 0) {
      leadingCommentsThenBareGet.lastIndex = i;
      const match = leadingCommentsThenBareGet.exec(props);
      if (match && match.index === i) return commentsIn(match[1]);
    }
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
  }
  return [];
}

function addComments(byComponent, tag, comments) {
  if (!comments.length) return;
  const key = normalizeTag(tag);
  byComponent[key] = [...(byComponent[key] || []), ...comments];
}

/**
 * Map component tag → coverage comments that lead that component's
 * `children` getter. Pins hand-off placement, not just export presence.
 */
exports.pragmasByExport = function pragmasByExport(code) {
  const descriptorComments = Object.create(null);
  const descRe = /\b(_d\$\d*)\s*=\s*\{/g;
  for (const match of code.matchAll(descRe)) {
    const body = propsObjectSlice(code, match.index + match[0].length);
    if (!body) continue;
    descriptorComments[match[1]] = topLevelBareGetComments(body);
  }

  const ctorChildrenDesc = Object.create(null);
  const ctorRe = /function\s+(_P\$\d*)\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/g;
  for (const match of code.matchAll(ctorRe)) {
    const childDef = match[2].match(
      /Object\.defineProperty\(\s*this\s*,\s*"children"\s*,\s*(_d\$\d*)\s*\)/
    );
    if (childDef) ctorChildrenDesc[match[1]] = childDef[1];
  }

  // `createComponent(Tag, new _P$N)` / `Tag(new _P$N)` / `_$Tag(new _P$N)`.
  const ctorTag = Object.create(null);
  const ctorTagRe =
    /(?:(?:_\$)?createComponent\(\s*([A-Za-z_$][\w$]*)\s*,\s*|((?:_\$)?[A-Za-z][\w$]*)\s*\()\s*new\s+(_P\$\d*)\s*\(/g;
  for (const match of code.matchAll(ctorTagRe)) {
    ctorTag[match[3]] = match[1] || match[2];
  }

  const result = {};
  const sections = code.split(/^export const (\w+) = /m);
  for (let i = 1; i < sections.length; i += 2) {
    const exportName = sections[i];
    const body = sections[i + 1];
    const byComponent = Object.create(null);

    // DOM: `_$createComponent(Tag, { … })`
    // SSR inline: `Tag({ … })` / `_$Show({ … })`
    const propsCallRe =
      /(?:(?:_\$)?createComponent\(\s*([A-Za-z_$][\w$]*)\s*,\s*|((?:_\$)?[A-Za-z][\w$]*)\s*\()\s*\{/g;
    for (const match of body.matchAll(propsCallRe)) {
      const tag = match[1] || match[2];
      // Skip runtime helpers that take object literals.
      if (/^_\$?(ssr|mergeProps|spread|memo|effect)$/.test(tag)) continue;
      const props = propsObjectSlice(body, match.index + match[0].length);
      if (!props) continue;
      addComments(byComponent, tag, topLevelChildrenGetterComments(props));
    }

    for (const match of body.matchAll(/new\s+(_P\$\d*)\s*\(/g)) {
      const desc = ctorChildrenDesc[match[1]];
      const comments = desc && descriptorComments[desc];
      if (!comments?.length) continue;
      const tag = ctorTag[match[1]];
      if (!tag) continue;
      addComments(byComponent, tag, comments);
    }

    result[exportName] = emptyToUndefined(byComponent);
  }
  return result;
};
