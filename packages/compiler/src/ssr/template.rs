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
    /// Static `innerHTML` markup spliced into a part, as (part, byte range):
    /// opaque to `validate`, like the DOM's property write.
    pub(super) opaque: std::vec::Vec<(usize, std::ops::Range<usize>)>,
}

impl<'a> SsrTemplate<'a> {
    pub(super) fn new(initial: String) -> Self {
        Self {
            parts: vec![initial],
            values: std::vec::Vec::new(),
            declarations: std::vec::Vec::new(),
            post_declarations: std::vec::Vec::new(),
            groupable: std::vec::Vec::new(),
            opaque: std::vec::Vec::new(),
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

    pub(super) fn push_opaque(&mut self, text: &str) {
        let part = self.parts.len() - 1;
        let current = self.current_mut();
        let start = current.len();
        current.push_str(text);
        let end = current.len();
        self.opaque.push((part, start..end));
    }

    pub(super) fn append_template(&mut self, child: SsrTemplate<'a>) {
        let base = self.parts.len() - 1;
        let offset = self.current_mut().len();
        self.opaque
            .extend(child.opaque.into_iter().map(|(part, range)| match part {
                0 => (base, range.start + offset..range.end + offset),
                _ => (base + part, range),
            }));
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

    /// The `validate` input, shaped like the DOM's closed-tags variant: tags
    /// keep only their names (attribute and hydration-key holes drop with
    /// the attributes), content holes join as nothing, and `innerHTML`
    /// markup is skipped. The flag reports whether a content hole exists.
    pub(super) fn validation_markup(&self) -> (String, bool) {
        enum State {
            Content,
            Tag(Option<String>),
            Quoted(Option<String>, char),
            Comment,
            Raw(String),
        }
        let mut html = String::new();
        let mut content_holes = false;
        let mut state = State::Content;
        for (index, part) in self.parts.iter().enumerate() {
            if index > 0 && matches!(state, State::Content) {
                content_holes = true;
            }
            let mut text = part.clone();
            let mut ranges: std::vec::Vec<_> = self
                .opaque
                .iter()
                .filter(|(owner, _)| *owner == index)
                .map(|(_, range)| range.clone())
                .collect();
            ranges.sort_by_key(|range| std::cmp::Reverse(range.start));
            for range in ranges {
                text.replace_range(range, "");
            }
            let mut cursor = 0;
            while let Some(ch) = text[cursor..].chars().next() {
                let rest = &text[cursor..];
                cursor += ch.len_utf8();
                state = match state {
                    State::Content if rest.starts_with("<!--") => {
                        html.push_str("<!--");
                        cursor += 3;
                        State::Comment
                    }
                    State::Content
                        if ch == '<'
                            && rest[1..].starts_with(|c: char| c.is_ascii_alphabetic()) =>
                    {
                        let name_end = rest[1..]
                            .find(|c: char| c.is_ascii_whitespace() || c == '/' || c == '>')
                            .map_or(rest.len(), |end| end + 1);
                        let name = rest[1..name_end].to_ascii_lowercase();
                        cursor += name_end - 1;
                        html.push('<');
                        html.push_str(&name);
                        // Raw-text/RCDATA contents never parse as markup.
                        let raw =
                            matches!(name.as_str(), "script" | "style" | "textarea" | "title")
                                .then_some(name);
                        State::Tag(raw)
                    }
                    State::Content => {
                        html.push(ch);
                        State::Content
                    }
                    State::Tag(raw) if ch == '"' || ch == '\'' => State::Quoted(raw, ch),
                    State::Tag(raw) if ch == '>' => {
                        html.push('>');
                        raw.map_or(State::Content, State::Raw)
                    }
                    State::Tag(raw) => State::Tag(raw),
                    State::Quoted(raw, quote) if ch == quote => State::Tag(raw),
                    State::Quoted(raw, quote) => State::Quoted(raw, quote),
                    State::Comment => {
                        html.push(ch);
                        if html.ends_with("-->") {
                            State::Content
                        } else {
                            State::Comment
                        }
                    }
                    State::Raw(name)
                        if ch == '<'
                            && rest[1..].starts_with('/')
                            && rest[2..]
                                .get(..name.len())
                                .is_some_and(|tag| tag.eq_ignore_ascii_case(&name)) =>
                    {
                        html.push('<');
                        State::Content
                    }
                    State::Raw(name) => {
                        html.push(ch);
                        State::Raw(name)
                    }
                };
            }
        }
        (html, content_holes)
    }
}
