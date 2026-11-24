/** @jsxImportSource @solidjs/web */

import type { ParentProps } from "solid-js";

const text = document.createTextNode("hello");
const span = document.createElement("span");

<div>{text}</div>;
<div>{[text, span]}</div>;

function Parent(props: ParentProps) {
  return <section>{props.children}</section>;
}

<Parent>{text}</Parent>;
<Parent>{[text, span]}</Parent>;

<selectedcontent />;

<math displaystyle="true">
  <mo
    fence="true"
    largeop="false"
    movablelimits="false"
    separator="false"
    stretchy="false"
    symmetric="false"
    accent="false"
  >
    (
  </mo>
  <mover accent="true" />
  <munder accentunder="true" />
  <munderover accent="true" accentunder="false" />
</math>;
// @ts-expect-error MathML booleans are the strings "true" and "false", and `true` writes an empty attribute
<mo stretchy={true} />;
// @ts-expect-error a bare MathML boolean writes an empty attribute
<mo stretchy />;
