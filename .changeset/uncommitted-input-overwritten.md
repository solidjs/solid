---
"@solidjs/web": patch
"@solidjs/babel-plugin": patch
"@solidjs/compiler": patch
"@solidjs/signals": patch
"solid-js": patch
---

Dev builds now warn with `UNCOMMITTED_INPUT_OVERWRITTEN` (#4186) when a stateful DOM property binding (`value`/`checked` on an input, `value` on a textarea, `value`/`selected` on an option, `muted` on media) is about to re-write the value it wrote last time over an edit the user never committed to the bound signal — e.g. `value={props.name} onChange={commit}` with no draft signal, when another dynamic attribute in the same template changes. Runtime behavior is unchanged: the write still happens, once per element and property the warning names the fix (write the signal from `onInput`, use `defaultValue`/`defaultChecked` for an uncontrolled element, or write a rejected edit back with `e.currentTarget.value = next`).

Production output is unchanged byte for byte. In dev DOM output both compilers write stateful properties through a new `setStatefulProperty(el, name, value)` helper instead of the inline `el.name = value`; hydratable output keeps `setProperty`, and `spread`/`assign` check in the runtime. The check lives only in `@solidjs/web`'s dev build; the production entry carries a plain `node[name] = value` stub that no production-compiled module imports, so it tree-shakes away.

The "Form inputs" section of the DOM RFC, the cheatsheet and the solid-2.0 skill now say that a change to any other dynamic attribute in the same template re-runs a stateful binding, link the new code, and drop `equals: false` as a way to reject input (it is what the warning reports); write the accepted value back with `e.currentTarget.value = next` instead.
