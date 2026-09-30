export const istanbulPragma = (
  <Show when={condition()}>
    {/* istanbul ignore next */}
    <div>Hello</div>
  </Show>
);

export const c8Pragma = (
  <Show when={condition()}>
    {/* c8 ignore next */}
    <div>Hello</div>
  </Show>
);

export const expressionChild = (
  <Show when={condition()}>
    {/* c8 ignore next */}
    {state.value}
  </Show>
);

export const multipleChildren = (
  <Comp>
    {/* istanbul ignore next */}
    <div>A</div>
    <span>B</span>
  </Comp>
);

export const nestedComponent = (
  <Outer>
    <Inner>
      {/* c8 ignore next */}
      <div>A</div>
    </Inner>
  </Outer>
);

export const twoContainers = (
  <Comp>
    {/* istanbul ignore next */}
    {/* c8 ignore next */}
    <div>A</div>
  </Comp>
);

export const noteBesidePragma = (
  <Comp>
    {/* note */
    /* c8 ignore next */}
    <div>A</div>
  </Comp>
);

export const textAfterPragma = (
  <Comp>
    {/* c8 ignore next */}text<div>A</div>
  </Comp>
);

export const spaceAfterPragma = (
  <Comp>
    {/* c8 ignore next */} <div>A</div>
  </Comp>
);

export const lineComment = (
  <Comp>
    {
      // c8 ignore next
    }
    <div>A</div>
  </Comp>
);

export const lineCommentMentioningBlock = (
  <Comp>
    {
      // see /* c8 ignore next */
    }
    <div>A</div>
  </Comp>
);

export const blockCommentMentioningLine = (
  <Comp>
    {/* see // c8 ignore next */}
    <div>A</div>
  </Comp>
);

export const trailingPragma = (
  <Comp>
    <div>A</div>
    {/* c8 ignore next */}
  </Comp>
);

export const notePragmaOnly = (
  <Comp>
    {/* just a note */}
    <div>A</div>
  </Comp>
);

export const lookalike = (
  <Comp>
    {/* c8 ignored */}
    <div>A</div>
  </Comp>
);
