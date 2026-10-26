use super::*;

pub(super) struct Render<'a> {
    pub(super) source: &'a str,
    pub(super) hash: &'a str,
    pub(super) minify: bool,
    pub(super) local_keyframes: &'a BTreeSet<String>,
}

impl Render<'_> {
    pub(super) fn items(&mut self, items: &[Item], global: bool) -> String {
        if items.is_empty() {
            return String::new();
        }
        let start = items.first().unwrap().span().0;
        let end = items.last().unwrap().span().1;
        let mut out = String::new();
        let mut cursor = start;
        for item in items {
            let (a, b) = item.span();
            out.push_str(&self.source[cursor..a]);
            out.push_str(&self.item(item, global));
            cursor = b;
        }
        out.push_str(&self.source[cursor..end]);
        out
    }

    fn item(&mut self, item: &Item, global: bool) -> String {
        match item {
            Item::Rule(rule) => self.rule(rule, global),
            Item::At(at) => self.at_rule(at, global),
            Item::Decl(decl) => self.declaration(decl),
        }
    }

    fn rule(&mut self, rule: &Rule, in_global: bool) -> String {
        let used = rule.selectors.selectors.iter().any(|x| x.used);
        let empty = self.rule_empty(rule);
        if empty || (!used && !in_global) {
            let label = if empty { "empty" } else { "unused" };
            return format!(
                "/* ({label}) {}*/",
                escape_comment_close(&self.source[rule.start..rule.end])
            );
        }
        if rule.global_block
            && rule.selectors.selectors.len() == 1
            && rule.selectors.selectors[0].parts.len() == 1
            && rule.selectors.selectors[0].parts[0].simple.len() == 1
        {
            let inside = self.block_contents(&rule.block, true);
            return if self.minify {
                inside
            } else {
                format!(
                    "/* {}*/{}/*{}*/",
                    &self.source[rule.start..=rule.block.start],
                    inside,
                    &self.source[rule.block.end - 1..rule.end]
                )
            };
        }
        // `@tsrx/core` creates a fresh, unbumped specificity state for every
        // rule selector list. Its ancestor check is keyed by
        // `has_local_selectors`, which remains false in the analyzer; nested
        // implicit selectors therefore receive `.hash`, not `:where(.hash)`.
        let mut specificity = false;
        let selectors = self.selector_list(
            &rule.selectors,
            in_global,
            &mut specificity,
            rule.parent.is_some(),
        );
        let body = self.block_contents(&rule.block, in_global || rule.global_block);
        format!(
            "{}{}{}",
            selectors,
            &self.source[rule.selectors.end..=rule.block.start],
            body + &self.source[rule.block.end - 1..rule.end]
        )
    }

    fn rule_empty(&self, rule: &Rule) -> bool {
        if rule.global_block {
            return rule.block.items.is_empty();
        }
        rule.block.items.iter().all(|item| match item {
            Item::Decl(_) => false,
            Item::Rule(child) => {
                !child.selectors.selectors.iter().any(|x| x.used) || self.rule_empty(child)
            }
            Item::At(at) => at.block.as_ref().is_some_and(|x| x.items.is_empty()),
        })
    }

    fn block_contents(&mut self, block: &Block, global: bool) -> String {
        if block.items.is_empty() {
            return self.source[block.start + 1..block.end - 1].to_string();
        }
        let mut out = String::new();
        let mut cursor = block.start + 1;
        for item in &block.items {
            let (a, b) = item.span();
            out.push_str(&self.source[cursor..a]);
            out.push_str(&self.item(item, global));
            cursor = b;
        }
        out.push_str(&self.source[cursor..block.end - 1]);
        out
    }

    fn at_rule(&mut self, at: &AtRule, global: bool) -> String {
        if strip_prefix(&at.name) == "keyframes" {
            let raw = &self.source[at.start..at.end];
            let name_start = at.prelude_start
                + self.source[at.prelude_start..]
                    .find(|c: char| !c.is_whitespace())
                    .unwrap_or(0);
            let authored = at.prelude.trim();
            let rendered = if let Some(rendered) = authored.strip_prefix("-global-") {
                rendered
            } else if !global {
                return replace_range(
                    raw,
                    name_start - at.start,
                    name_start - at.start,
                    &format!("{}-", self.hash),
                );
            } else {
                authored
            };
            return replace_range(
                raw,
                name_start - at.start,
                name_start - at.start + authored.len(),
                rendered,
            );
        }
        let Some(block) = &at.block else {
            return self.source[at.start..at.end].to_string();
        };
        format!(
            "{}{}{}",
            &self.source[at.start..=block.start],
            self.block_contents(block, global),
            &self.source[block.end - 1..at.end]
        )
    }

    fn declaration(&self, decl: &Declaration) -> String {
        let mut raw = self.source[decl.start..decl.end_with_semicolon].to_string();
        if matches!(
            strip_prefix(&decl.property).as_str(),
            "animation" | "animation-name"
        ) {
            let value_offset = decl.value_start - decl.start;
            let rewritten = rewrite_animation(&decl.value, self.hash, self.local_keyframes);
            raw = replace_range(
                &raw,
                value_offset,
                value_offset + decl.value.len(),
                &rewritten,
            );
        }
        raw
    }

    fn selector_list(
        &mut self,
        list: &SelectorList,
        global: bool,
        specificity: &mut bool,
        nested_rule: bool,
    ) -> String {
        let mut out = String::new();
        let mut cursor = list.start;
        let mut pruning = false;
        for (index, complex) in list.selectors.iter().enumerate() {
            let used = complex.used || global;
            if !used && !pruning {
                if self.minify {
                    // The run is omitted below, including one separator.
                } else if index == 0 {
                    out.push_str(&self.source[cursor..complex.start]);
                    out.push_str("/* (unused) ");
                } else {
                    out.push_str(" /* (unused) ");
                }
                cursor = complex.start;
                pruning = true;
            } else if used && pruning {
                let separator = &self.source[cursor..complex.start];
                let comma = separator.rfind(',').unwrap_or(0);
                if !self.minify {
                    out.push_str(&self.source[cursor..cursor + comma]);
                    out.push_str("*/");
                    out.push_str(&separator[comma..]);
                } else if index > 0 && !out.trim_end().ends_with(',') {
                    out.push(',');
                }
                cursor = complex.start;
                pruning = false;
            }
            if used {
                out.push_str(&self.source[cursor..complex.start]);
                let mut complex_specificity = *specificity;
                out.push_str(&self.complex(complex, global, &mut complex_specificity, nested_rule));
                cursor = complex.end;
            } else if !self.minify {
                out.push_str(&escape_comment_close(&self.source[cursor..complex.end]));
                cursor = complex.end;
            } else {
                cursor = complex.end;
            }
        }
        if pruning {
            if !self.minify {
                out.push_str("*/");
            }
        } else {
            out.push_str(&self.source[cursor..list.end]);
        }
        out
    }

    fn complex(
        &mut self,
        complex: &Complex,
        global: bool,
        specificity: &mut bool,
        nested_rule: bool,
    ) -> String {
        let mut edits: Vec<(usize, usize, String)> = Vec::new();
        for relative in &complex.parts {
            for simple in &relative.simple {
                self.simple_edits(
                    simple,
                    relative,
                    global,
                    specificity,
                    nested_rule,
                    &mut edits,
                );
            }
            if relative.scoped && !global && !relative.global && !relative.global_like {
                let modifier = if *specificity {
                    format!(":where(.{})", self.hash)
                } else {
                    *specificity = true;
                    format!(".{}", self.hash)
                };
                if !(relative
                    .simple
                    .iter()
                    .any(|x| matches!(x, Simple::Nest(..)))
                    || relative.simple.len() == 1
                        && matches!(
                            &relative.simple[0],
                            Simple::Pseudo(Pseudo { name, .. }) if name == "is" || name == "where"
                        ))
                {
                    if let Some(target) = relative
                        .simple
                        .iter()
                        .rev()
                        .find(|x| !matches!(x, Simple::Pseudo(_) | Simple::PseudoElement(..)))
                    {
                        let (a, b) = target.span();
                        if matches!(target, Simple::Type(name, ..) if name == "*") {
                            edits.push((a, b, modifier));
                        } else {
                            edits.push((b, b, modifier));
                        }
                    } else if let Some(first) = relative.simple.first() {
                        edits.push((first.span().0, first.span().0, modifier));
                    }
                }
            }
        }
        apply_edits(self.source, complex.start, complex.end, edits)
    }

    fn simple_edits(
        &mut self,
        simple: &Simple,
        relative: &Relative,
        global: bool,
        specificity: &mut bool,
        nested_rule: bool,
        edits: &mut Vec<(usize, usize, String)>,
    ) {
        let Simple::Pseudo(pseudo) = simple else {
            return;
        };
        if pseudo.name == "global" {
            if let Some(args) = &pseudo.args {
                edits.push((pseudo.start, args.start, String::new()));
                edits.push((args.end, pseudo.end, String::new()));
            } else {
                let start = relative
                    .combinator
                    .as_ref()
                    .filter(|(name, _, _)| name == " ")
                    .map_or(pseudo.start, |(_, start, _)| *start);
                let replacement = if nested_rule && relative.combinator.is_none() && relative.global
                {
                    "&"
                } else {
                    ""
                };
                edits.push((start, pseudo.end, replacement.into()));
            }
            return;
        }
        if matches!(pseudo.name.as_str(), "is" | "where" | "has" | "not")
            && let Some(args) = &pseudo.args
        {
            let rendered = self.selector_list(args, global || relative.global, specificity, false);
            edits.push((args.start, args.end, rendered));
        }
    }
}

fn rewrite_animation(value: &str, hash: &str, names: &BTreeSet<String>) -> String {
    let mut out = String::with_capacity(value.len());
    let mut token = String::new();
    for ch in value.chars().chain(std::iter::once(';')) {
        if ch.is_whitespace() || matches!(ch, ',' | ';' | '}') {
            if names.contains(&token) {
                out.push_str(hash);
                out.push('-');
            }
            out.push_str(&token);
            token.clear();
            if ch != ';' {
                out.push(ch);
            }
        } else {
            token.push(ch);
        }
    }
    out
}

pub(super) fn strip_prefix(name: &str) -> String {
    for prefix in ["-webkit-", "-moz-", "-o-", "-ms-"] {
        if let Some(rest) = name.to_ascii_lowercase().strip_prefix(prefix) {
            return rest.to_string();
        }
    }
    name.to_ascii_lowercase()
}

pub(super) fn unescape_ident(name: &str) -> String {
    let mut out = String::new();
    let mut escaped = false;
    for ch in name.chars() {
        if escaped {
            out.push(ch);
            escaped = false;
        } else if ch == '\\' {
            escaped = true;
        } else {
            out.push(ch);
        }
    }
    out
}

fn escape_comment_close(source: &str) -> String {
    source.replace("*/", "*\\/")
}

fn replace_range(source: &str, start: usize, end: usize, replacement: &str) -> String {
    format!("{}{}{}", &source[..start], replacement, &source[end..])
}

fn apply_edits(
    source: &str,
    start: usize,
    end: usize,
    mut edits: Vec<(usize, usize, String)>,
) -> String {
    edits.sort_by_key(|x| (x.0, x.1));
    let mut out = String::new();
    let mut cursor = start;
    for (a, b, replacement) in edits {
        if a < cursor {
            continue;
        }
        out.push_str(&source[cursor..a]);
        out.push_str(&replacement);
        cursor = b;
    }
    out.push_str(&source[cursor..end]);
    out
}
