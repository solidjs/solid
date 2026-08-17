---
"solid-js": patch
---

Make the `splitProps` proxy path honor first-match key ownership. A key listed in two groups leaked into the later group for stores and component props (`get`, `in`, `Object.keys`, spread), while the plain-object path already assigned it to the first group only.
