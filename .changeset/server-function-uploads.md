---
"@solidjs/web": patch
---

With `enableRichArguments()`, a server function can take files and blobs anywhere in its arguments. Calls like `upload(file, { tags })`, `upload({ file })` and `upload(formData, 1)` used to fail before sending. They now send multipart form data, with each file as its own part instead of encoded inside the arguments.
