---
"@solidjs/babel-plugin": patch
"@solidjs/compiler": patch
---

With `omitNestedClosingTags: true`, both compilers now keep the closing tags the HTML parser needs inside forms, custom elements, `<legend>`, nested lists, and the SVG and MathML elements that hold HTML (`<foreignObject>`, `<desc>`, `<title>`, `<mi>`, `<mo>`, `<mn>`, `<ms>`, `<mtext>` and `<annotation-xml>`, in any letter case), so the template parses to the tree the JSX describes instead of throwing at render.
