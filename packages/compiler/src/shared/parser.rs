//! Parser compatibility helpers.

/// Babel accepts parenthesized sequence expressions in JSX containers. Oxc
/// still builds the correct AST for them but emits TypeScript diagnostic
/// 18007, so ignore that diagnostic and preserve the compiler's existing
/// syntax contract.
pub(crate) fn first_parser_error(
    diagnostics: impl IntoIterator<Item = impl std::fmt::Display>,
) -> Option<String> {
    diagnostics.into_iter().find_map(|diagnostic| {
        let message = diagnostic.to_string();
        (!message.contains("JSX expressions may not use the comma operator")).then_some(message)
    })
}
