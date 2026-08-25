use oxc_ast::ast::Expression;

/// One `_v$N`/`_ref$N`/`_g$N` hoisted declaration. Grouping nulls consumed
/// slots in place (Babel keeps indices stable and filters at the end).
pub(super) type SsrDeclaration<'a> = Option<(String, Expression<'a>)>;

pub(super) struct SsrTemplate<'a> {
    pub(super) parts: std::vec::Vec<String>,
    pub(super) values: std::vec::Vec<Expression<'a>>,
    /// Hoisted temp-var declarations, in evaluation order (Babel's
    /// `results.declarations`).
    pub(super) declarations: std::vec::Vec<SsrDeclaration<'a>>,
    /// Stateful-attribute closures evaluate after everything else and never
    /// group (Babel's `results.postDeclarations`).
    pub(super) post_declarations: std::vec::Vec<(String, Expression<'a>)>,
    /// Declaration names eligible for `ssrGroup` coalescing (Babel's
    /// `results.groupable`).
    pub(super) groupable: std::vec::Vec<String>,
}

impl<'a> SsrTemplate<'a> {
    pub(super) fn new(initial: String) -> Self {
        Self {
            parts: vec![initial],
            values: std::vec::Vec::new(),
            declarations: std::vec::Vec::new(),
            post_declarations: std::vec::Vec::new(),
            groupable: std::vec::Vec::new(),
        }
    }

    pub(super) fn current_mut(&mut self) -> &mut String {
        self.parts
            .last_mut()
            .expect("SSR template always has a current part")
    }

    pub(super) fn push_expr(&mut self, value: Expression<'a>) {
        self.values.push(value);
        self.parts.push(String::new());
    }

    pub(super) fn append_template(&mut self, child: SsrTemplate<'a>) {
        let mut child_parts = child.parts.into_iter();
        if let Some(first) = child_parts.next() {
            self.current_mut().push_str(&first);
        }
        for (value, next_part) in child.values.into_iter().zip(child_parts) {
            self.push_expr(value);
            self.current_mut().push_str(&next_part);
        }
        self.declarations.extend(child.declarations);
        self.post_declarations.extend(child.post_declarations);
        self.groupable.extend(child.groupable);
    }
}
