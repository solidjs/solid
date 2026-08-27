//! Ergonomic read-only view over the `FlatTape` returned by
//! `tsrx_parser_engine`.
//!
//! The tape is a flat record encoding of the same ESTree+TSRX AST that
//! `@tsrx/core` produces (verified against it construct-by-construct), with
//! spans in authored UTF-8 byte offsets. Scalars are stored as JSON
//! spellings, so string fields come back quoted and need decoding.

use tsrx_tape_schema::{FlatTape, RecordIndex, ValueKind, ValueRef};

/// One AST node (an object record with a `type` field) in the tape.
#[derive(Clone, Copy)]
pub struct Node<'t> {
    tape: &'t FlatTape,
    object: RecordIndex,
}

impl<'t> Node<'t> {
    pub fn root(tape: &'t FlatTape) -> Option<Node<'t>> {
        Node::from_value(tape, tape.root())
    }

    pub fn from_value(tape: &'t FlatTape, value: ValueRef) -> Option<Node<'t>> {
        value.as_object().map(|object| Node { tape, object })
    }

    /// The node's `type` string (e.g. `"JSXIfExpression"`).
    pub fn ty(self) -> &'t str {
        self.str_field("type").unwrap_or("")
    }

    /// Authored byte span (`start`, `end`).
    pub fn span(self) -> Option<(u32, u32)> {
        Some((self.u32_field("start")?, self.u32_field("end")?))
    }

    pub fn field(self, name: &str) -> ValueRef {
        self.tape
            .field_index(self.object, name)
            .and_then(|field| self.tape.field_value(field))
            .unwrap_or(ValueRef::MISSING)
    }

    /// A child node field; `None` when missing, JSON `null`, or not an object.
    pub fn node_field(self, name: &str) -> Option<Node<'t>> {
        Node::from_value(self.tape, self.field(name))
    }

    /// A list-of-nodes field; empty when missing. Non-object entries (JSON
    /// `null` holes in e.g. array patterns) come back as `None`.
    pub fn list_field(self, name: &str) -> impl Iterator<Item = Option<Node<'t>>> + 't {
        self.list_value(self.field(name))
    }

    /// Iterate a list-valued `ValueRef` as (possibly null) nodes.
    pub fn list_value(self, value: ValueRef) -> impl Iterator<Item = Option<Node<'t>>> + 't {
        let tape = self.tape;
        let first = value.as_list().and_then(|list| tape.list_first_value(list));
        NodeIter { tape, next: first }
    }

    /// Decoded string field (tape scalars carry JSON spellings).
    pub fn str_field(self, name: &str) -> Option<&'t str> {
        let scalar = self.tape.scalar(self.field(name))?;
        scalar
            .strip_prefix('"')
            .and_then(|scalar| scalar.strip_suffix('"'))
    }

    pub fn u32_field(self, name: &str) -> Option<u32> {
        self.tape.scalar_u32(self.field(name))
    }

    pub fn bool_field(self, name: &str) -> bool {
        self.tape.scalar(self.field(name)) == Some("true")
    }

    pub fn has_node_field(self, name: &str) -> bool {
        self.field(name).kind() == ValueKind::Object
    }

    /// All (key, value) fields, for generic traversal.
    pub fn fields(self) -> impl Iterator<Item = (&'t str, ValueRef)> + 't {
        let tape = self.tape;
        tape.fields(self.object)
            .map(move |field| (tape.key(field), field.value))
    }

    pub fn tape(self) -> &'t FlatTape {
        self.tape
    }
}

struct NodeIter<'t> {
    tape: &'t FlatTape,
    next: Option<RecordIndex>,
}

impl<'t> Iterator for NodeIter<'t> {
    type Item = Option<Node<'t>>;

    fn next(&mut self) -> Option<Self::Item> {
        let entry = self.next.take()?;
        if entry.is_none() {
            return None;
        }
        let value = self.tape.list_value(entry)?;
        self.next = self.tape.list_value_next(entry);
        Some(Node::from_value(self.tape, value))
    }
}

/// Generic walk over every node value reachable from `node`'s fields,
/// skipping non-semantic keys. `visit` returns `false` to stop descending
/// into a subtree (its children were consumed by the caller).
pub fn walk<'t>(node: Node<'t>, visit: &mut impl FnMut(Node<'t>) -> bool) {
    if !visit(node) {
        return;
    }
    walk_children(node, visit);
}

/// Walk `node`'s children without re-visiting `node` itself.
pub fn walk_children<'t>(node: Node<'t>, visit: &mut impl FnMut(Node<'t>) -> bool) {
    for (key, value) in node.fields() {
        if matches!(key, "type" | "start" | "end" | "metadata" | "loc" | "range") {
            continue;
        }
        match value.kind() {
            ValueKind::Object => {
                if let Some(child) = Node::from_value(node.tape(), value) {
                    walk(child, visit);
                }
            }
            ValueKind::List => {
                if let Some(list) = value.as_list() {
                    let mut next = node.tape().list_first_value(list);
                    while let Some(entry) = next.filter(|entry| !entry.is_none()) {
                        if let Some(item) = node.tape().list_value(entry)
                            && let Some(child) = Node::from_value(node.tape(), item)
                        {
                            walk(child, visit);
                        }
                        next = node.tape().list_value_next(entry);
                    }
                }
            }
            _ => {}
        }
    }
}
