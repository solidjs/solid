---
"@solidjs/web": patch
---

Keep the metadata of files and blobs sent to server functions with `enableRichArguments()`. A blob arrives as a `Blob` instead of a `File` named `blob`, an empty type stays empty instead of `application/octet-stream`, and a file keeps its exact name and its `lastModified`. The server still reads uploads from clients that send only the part index.
