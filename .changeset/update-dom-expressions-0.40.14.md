---
"solid-js": patch
"babel-preset-solid": patch
---

Update DOM Expressions to 0.40.14. The server build now escapes `<style>` and `<script>` children inside MathML (#4704), and string literals in a ternary branch, after `&&`, or returned from a function child (#4710).
