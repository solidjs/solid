//! Solid 1.x attribute forms that 2.0 removed (#4187).
//!
//! Left alone they compile into literal attributes (`<div use:tip="() => {}">`,
//! `classlist="[object Object]"`) with no diagnostic, so on native elements of
//! the web generates (`dom` / `ssr`) they are a compile error that names the
//! 2.0 replacement. Components are untouched (their props are user-defined
//! names with no compiler semantics), as is the universal generate (a custom
//! renderer's `setProp` owns its own naming), and every other namespace —
//! `prop:`, `xlink:`, `xml:`, `xmlns:`, `svg:`, … — still compiles as before.
//! The message text mirrors Babel's `removedAttributeMessage`
//! (`packages/babel-plugin/src/shared/removed.ts`); keep the two in sync.

use oxc_ast::ast::{JSXAttributeItem, JSXAttributeName, JSXElement};

use crate::error::{Error, Result};

/// The migration message for a removed 1.x attribute `key` on `<tag_name>`,
/// or `None` when `key` is still valid in 2.0.
pub(crate) fn removed_attribute_message(tag_name: &str, key: &str) -> Option<String> {
    if key == "classList" {
        return Some(format!(
            "`classList` on <{tag_name}> was removed in Solid 2.0. \
             Use `class` with an object or array instead: `class={{{{ active: isActive() }}}}` \
             or `class={{[\"base\", {{ active: isActive() }}]}}`."
        ));
    }
    let (namespace, name) = key.split_once(':')?;
    let removed = format!(
        "`{key}` on <{tag_name}> uses the `{namespace}:` namespace, which was removed in Solid 2.0."
    );
    match namespace {
        "on" | "oncapture" => Some(format!(
            "{removed} Use a camelCase handler such as `onClick={{handler}}` for Solid events, \
             or a `ref` callback that calls `addEventListener` for listener options or custom event names."
        )),
        "attr" => Some(format!(
            "{removed} Attributes are the default in 2.0: write `{name}={{value}}` \
             (or `prop:{name}` to set a DOM property)."
        )),
        "bool" => Some(format!(
            "{removed} Boolean values add or remove the attribute in 2.0: write `{name}={{condition}}`."
        )),
        "use" => Some(format!(
            "{removed} Use a `ref` directive factory instead: `ref={{{name}(options)}}`, \
             or `ref={{{name}}}` without options; arrays compose (`ref={{[a, b]}}`)."
        )),
        _ => None,
    }
}

/// Errors at the first removed 1.x attribute form on a native element. The
/// message carries the attribute's `line:column` (1-based column, like the
/// `validate` error) since there is no code frame.
pub(crate) fn check_removed_attributes(
    source: &str,
    element: &JSXElement<'_>,
    tag_name: &str,
) -> Result<()> {
    for attribute in &element.opening_element.attributes {
        let JSXAttributeItem::Attribute(attribute) = attribute else {
            continue;
        };
        let key = match &attribute.name {
            JSXAttributeName::Identifier(name) => name.name.to_string(),
            JSXAttributeName::NamespacedName(name) => {
                format!("{}:{}", name.namespace.name, name.name.name)
            }
        };
        if let Some(message) = removed_attribute_message(tag_name, &key) {
            let (line, column) = crate::shared::location::line_column(source, attribute.span.start);
            return Err(Error::transform(format!(
                "{message} ({line}:{})",
                column + 1
            )));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::removed_attribute_message;

    #[test]
    fn removed_forms_name_their_replacement() {
        assert_eq!(
            removed_attribute_message("div", "classList").as_deref(),
            Some(
                "`classList` on <div> was removed in Solid 2.0. Use `class` with an object or \
                 array instead: `class={{ active: isActive() }}` or \
                 `class={[\"base\", { active: isActive() }]}`."
            )
        );
        assert_eq!(
            removed_attribute_message("button", "on:click").as_deref(),
            Some(
                "`on:click` on <button> uses the `on:` namespace, which was removed in Solid 2.0. \
                 Use a camelCase handler such as `onClick={handler}` for Solid events, or a `ref` \
                 callback that calls `addEventListener` for listener options or custom event names."
            )
        );
        assert!(
            removed_attribute_message("div", "oncapture:click")
                .unwrap()
                .contains("the `oncapture:` namespace")
        );
        assert_eq!(
            removed_attribute_message("div", "attr:foo").as_deref(),
            Some(
                "`attr:foo` on <div> uses the `attr:` namespace, which was removed in Solid 2.0. \
                 Attributes are the default in 2.0: write `foo={value}` (or `prop:foo` to set a \
                 DOM property)."
            )
        );
        assert_eq!(
            removed_attribute_message("div", "bool:hidden").as_deref(),
            Some(
                "`bool:hidden` on <div> uses the `bool:` namespace, which was removed in Solid \
                 2.0. Boolean values add or remove the attribute in 2.0: write \
                 `hidden={condition}`."
            )
        );
        assert_eq!(
            removed_attribute_message("div", "use:tip").as_deref(),
            Some(
                "`use:tip` on <div> uses the `use:` namespace, which was removed in Solid 2.0. \
                 Use a `ref` directive factory instead: `ref={tip(options)}`, or `ref={tip}` \
                 without options; arrays compose (`ref={[a, b]}`)."
            )
        );
    }

    #[test]
    fn supported_names_pass() {
        for key in [
            "prop:value",
            "xlink:href",
            "xml:lang",
            "xmlns:xlink",
            "class",
            "classlist",
            "onClick",
            "onclick",
            "ref",
            "style",
            "class:active",
            "style:color",
        ] {
            assert_eq!(removed_attribute_message("div", key), None, "{key}");
        }
    }
}
