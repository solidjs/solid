---
"solid-js": patch
---

Context providers no longer create an owner of their own: the provided value now sits on the two memos that resolve the provider's children, so each provider allocates one node and one bound function fewer.
