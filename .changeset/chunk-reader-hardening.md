---
"@solidjs/web": patch
---

Cancelling a server function or frames stream partway through a chunk now ends it cleanly instead of failing as a malformed stream.

- Chunk headers must be exactly `;0x` plus 8 hex digits plus `;`, and payloads must be valid UTF-8.
- A stream that fails to decode is cancelled instead of being left unread.
- The reader frees the memory from a large chunk once it is read.
