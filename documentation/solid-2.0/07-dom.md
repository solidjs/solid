# RFC: DOM — attributes, class, and standards

**Start here:** If you’re migrating an app, read the beta tester guide first: [MIGRATION.md](MIGRATION.md)

## Summary

DOM behavior in Solid 2.0 follows HTML standards by default: attributes over properties, lowercase attribute names for built-ins, and consistent boolean handling. The `class` prop is enhanced (classList merged in, support for array/object for composition). These changes improve interoperability with web components and SSR and simplify the attribute/property story.

## Motivation

- **HTML standards:** Supporting multiple ways to set attributes/properties by type makes it harder to build on Solid (e.g. custom elements, SSR). Favoring attributes and lowercase aligns with the platform and removes special cases; `attr:` and `bool:` namespaces are no longer needed.
- **class:** Merging `classList` into `class` and supporting array/object (clsx-style) reduces API surface and supports composition without extra helpers.

## Detailed design

### Follow HTML standards by default

- **Attributes over properties:** Prefer setting attributes rather than properties in almost all cases. Aligns with web components and SSR.
- **Lowercasing:** Use HTML lowercase for built-in attribute names (no camelCase for attributes). Exceptions:
  - **Event handlers** remain camelCase (e.g. `onClick`) to keep the `on` modifier clear.
  - **Default to attributes** But attributes such as `input.value`, `input.defaultValue`, `input.checked`, `input.defaultChecked`, `select.value`, `option.value`, `option.selected`, `option.defaultSelected`, `textarea.value`, `textarea.defaultValue`, `video.muted`, `video.defaultMuted`, `audio.muted`, `audio.defaultMuted` continue to be handled as props where that avoids confusion. Unfortunately, this leads to all form fields be special cased. For example: `<input value={dynamicCurrentValue()} defaultValue={dynamicDefaultValue()}/>` either can be dynamic or static, and in the absense of `defaultValue`, then, `value` is SSRed.
- **Namespaces:** `attr:` and `bool:` namespaces are removed; the single standard behavior makes the model consistent.
- **XML Namespaces:** `svg` and `math` work as expected, however when using XML partials, an `xmlns` attribute is required for the browser to create the elements with the correct namespace. Solid adds these automatically to the tags that can recognize as SVG/MathML. For example an `a` tag returned from a partial to be used in XML need `xmlns` added by the user.
 
### Enhanced class prop

- **`classList` is removed;** its behavior is merged into `class`.
- **`class`** accepts: string, object (key = class name, value = truthy to apply), or array of strings/objects. Enables clsx-style composition. Example:

```jsx
<div class="card" />
<div class={{ active: isActive(), disabled: isDisabled() }} />
<div class={["card", props.class, { active: isActive() }]} />
```

### Consistent boolean handling

- Boolean literals add/remove the attribute (no `="true"` string). For attributes that require the string `"true"`, pass a string.
- Types are updated to reflect this.

```jsx
// Presence/absence boolean attributes
<video muted={true} />
<video muted={false} />

// When the platform requires a string value:
<some-element enabled="true" />
```

### Directives via `ref` (and removal of `use:`)

Solid 2.0 removes the `use:` directive namespace and instead treats “directives” as a first-class **ref** pattern. The `ref` prop becomes the single composition point for:

- DOM element access (`ref={el => ...}`)
- directive factories (`ref={tooltip(options)}`)
- composition (`ref={[a, b, c]}`; arrays may be nested)

```jsx
// 1.x: directive namespace
<input use:autofocus />
<button use:tooltip={{ content: "Save" }} />

// 2.0: directive/ref callbacks (factory form)
<input ref={autofocus} />
<button ref={tooltip({ content: "Save" })} />
```

Multiple refs (or directives) can be applied by passing an array:

```jsx
<button ref={[autofocus, tooltip({ content: "Save" })]} />
```

#### Two-phase directive factories (owned setup, unowned application)

The recommended directive pattern is **two-phase**, similar in spirit to “split effects” (compute phase vs apply phase):

- **Setup phase (owned):** run once to create reactive primitives and subscriptions. This phase should not perform imperative DOM mutation.
- **Apply phase (unowned):** receives the element and performs DOM writes (including reactive writes). This phase should not create reactive primitives.

```js
function titleDirective(source) {
  // Setup phase (owned): create primitives/subscriptions here
  // but avoid imperative DOM mutation at top level.
  let el;

  createEffect(source, value => {
    // Effect can run before the element is available
    if (el) el.title = value;
  });

  // Apply phase (unowned): DOM writes happen here.
  // No new primitives should be created in this callback.
  return nextEl => {
    el = nextEl;
    el.title = source();
  };
}
```

Used as:

```jsx
<button ref={titleDirective(() => props.title)} />
```

## Migration / replacement

- **classList:** Use `class` with an object or array instead.
- **Attributes:** Use lowercase attribute names; use string `"true"` only where the platform requires it.
- **Directives:** Replace `use:foo={...}` with `ref={foo(...)}` (or `ref={foo}` when no options are needed). Use an array when you need multiple directives/refs.

## Removals

| Removed | Replacement / notes |
|--------|----------------------|
| `classList` | Use `class` with object or array |
| `oncapture:` | Removed (replacement pattern TBD / use native event options where applicable) |
| `attr:` / `bool:` namespaces | Single attribute/property model above |
| `use:` directives | Use `ref` callbacks / directive factories (`ref={directive(opts)}`); arrays compose (`ref={[a, b]}`) |

`@solidjs/legacy` can provide compatibility for deprecated DOM APIs where feasible.

## Alternatives considered

- Keeping `classList` alongside `class` was rejected to avoid two ways to do the same thing and to simplify the compiler/runtime.
- Keeping camelCase for attributes was rejected in favor of HTML alignment and web component compatibility.

## Open questions

- Exact list of "default" props that stay as props (`input.value`, `input.defaultValue`, `input.checked`, `input.defaultChecked`, `select.value`, `option.value`, `option.selected`, `option.defaultSelected`, `textarea.value`, `textarea.defaultValue`, `video.muted`, `video.defaultMuted`, `audio.muted`, `audio.defaultMuted`, …). Generally, stateful DOM properties should be considered on this list.
