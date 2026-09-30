---
"@solidjs/web": patch
---

Binding slots: a slot property placed as a child (`<strong>{list.remaining}</strong> items left`) is a text position. The server emits a comment pair around it, `<!--_s:t=<occurrence>:<key>-->…<!--/_s:t-->`, with the escaped t=0 value inside on the document face and nothing on the stream face; the client writes the text between the markers from the occurrence's render effect, and a refetch's morph keeps the client's text. Strings and numbers render; nullish and booleans render empty, as a client insert renders them. Any other value is a new client dev finding (`BINDING_SLOT_POSITION`, reason `text-shape`) and clears. The content of `<textarea>`, `<title>`, `<style>` and `<script>` is not a text position (a comment is literal text there); bind `value=` or a style property instead.

Breaking: a slot property as a child used to render nothing and raise the `text` finding; it now renders and binds, and the `text` reason is retired.
