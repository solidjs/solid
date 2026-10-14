---
"@solidjs/web": patch
---

The shell-end marker is spliced in before `</body>` instead of being appended after `</html>` when the shell is a whole document (#4030). Async render mode and a stream with nothing pending now end with `</html>` again; a shell without `</body>` (an embedded render) still gets the marker appended.
