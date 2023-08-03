---
"solid-js": patch
---

Changes how the Setter type was declared without actually functionally changing it, fixing the Setter type being assignable to any other Setter type; fixes #1818.

Generically typed Setters must now non-null assert their parameter, i.e.

```diff
function myCustomSignal<T>(v: T) {
  const [get, set] = createSignal<T>();
-   const mySetter: Setter<T | undefined> = (v?) => set(v);
+   const mySetter: Setter<T | undefined> = (v?) => set(v!);

  const [get, set] = createSignal<T>(v);
-   const mySetter: Setter<T> = (v?) => set(v);
+   const mySetter: Setter<T> = (v?) => set(v!);
}
```
