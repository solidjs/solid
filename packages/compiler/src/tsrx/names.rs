use std::collections::{HashMap, HashSet};

use oxc_semantic::Semantic;

#[derive(Default)]
pub(super) struct Names {
    used: HashSet<String>,
    next: HashMap<&'static str, u32>,
}

impl Names {
    pub fn from_semantic(semantic: &Semantic<'_>) -> Self {
        let mut names = Self::default();
        for node in semantic.nodes() {
            match node.kind() {
                oxc_ast::AstKind::BindingIdentifier(ident) => {
                    names.used.insert(ident.name.to_string());
                }
                oxc_ast::AstKind::IdentifierReference(ident) => {
                    names.used.insert(ident.name.to_string());
                }
                oxc_ast::AstKind::JSXIdentifier(ident) => {
                    names.used.insert(ident.name.to_string());
                }
                _ => {}
            }
        }
        names
    }

    pub fn allocate(&mut self, prefix: &'static str) -> String {
        let mut index = *self.next.get(prefix).unwrap_or(&0);
        loop {
            let name = format!("{prefix}{index}");
            index += 1;
            if self.used.insert(name.clone()) {
                self.next.insert(prefix, index);
                return name;
            }
        }
    }
}
