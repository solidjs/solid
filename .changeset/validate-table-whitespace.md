---
"@solidjs/babel-plugin": patch
"@solidjs/compiler": patch
---

The `validate` check no longer reports whitespace that the HTML parser keeps in place as malformed HTML: whitespace between table cells, rows or columns (`<td>a</td> <td>b</td>`), and in a document shell between `<head>` children or between `</head>` and `<body>`.
