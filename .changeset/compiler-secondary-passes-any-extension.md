---
"@solidjs/compiler": patch
---

The secondary passes (`transformDirectives`, the lazy and refresh passes, source names) accept a filename with any extension. They run on code that is already lowered to JavaScript, so the filename is metadata rather than a parser choice: a known extension still picks its dialect, and any other (`App.rx`, from another front end) is parsed as TSX instead of failing with "Unknown file extension". This matters for server functions, whose IDs hash the filename: a front end can now pass the module's real path, so the ID matches the one `moduleForFunctionId` computes for that module. The JSX transform itself is unchanged.
