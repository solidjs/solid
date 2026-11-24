---
"@solidjs/compiler": patch
---

The native compiler now decodes HTML entities in JSX attribute strings only when they end with `;`, as Babel does, so a static `href="/s?a=1&param=2"` no longer becomes `/s?a=1¶m=2`; to match Babel, HTML5-only names (`&check;`, `&NewLine;`, `&AMP;`) and uppercase `&#X41;` stay literal, `&#0;` gives NUL, and a surrogate pair written as two references (`&#xD83D;&#xDE00;`) gives one character.
