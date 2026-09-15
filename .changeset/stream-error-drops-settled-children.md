---
"@solidjs/web": patch
---

`renderToStream` completes when a nested `<Loading>` settles before its parent fragment fails (#3478). A settled nested fragment parks its markup on the pending parent to be spliced in on resolve; when the parent then rejected, the splice ran over an undefined value, threw out of the fragment's resolver before `<key>_fr` could reject, and the response waited on it forever. The error path now drops the parked children — the client re-renders the whole subtree off the outer rejection — and the failure is reported once.
