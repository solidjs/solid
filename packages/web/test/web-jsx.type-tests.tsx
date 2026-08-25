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
