use super::*;

pub(super) struct Parser<'a> {
    src: &'a str,
    i: usize,
}

impl<'a> Parser<'a> {
    pub(super) fn new(src: &'a str) -> Self {
        Self { src, i: 0 }
    }

    pub(super) fn parse(mut self) -> Result<Sheet, StyleError> {
        let items = self.body(None)?;
        Ok(Sheet { items })
    }

    fn err<T>(&self, message: impl Into<String>) -> Result<T, StyleError> {
        Err(StyleError {
            message: message.into(),
            offset: self.i,
        })
    }

    fn body(&mut self, close: Option<u8>) -> Result<Vec<Item>, StyleError> {
        let mut out = Vec::new();
        loop {
            self.trivia()?;
            if self.i >= self.src.len() || close.is_some_and(|c| self.byte() == c) {
                return Ok(out);
            }
            out.push(if self.byte() == b'@' {
                Item::At(self.at_rule()?)
            } else if close.is_some() {
                self.block_item()?
            } else {
                Item::Rule(self.rule()?)
            });
        }
    }

    fn trivia(&mut self) -> Result<(), StyleError> {
        loop {
            while self.i < self.src.len() && self.byte().is_ascii_whitespace() {
                self.i += 1;
            }
            if self.rest().starts_with("/*") {
                let Some(n) = self.rest()[2..].find("*/") else {
                    return self.err("Unclosed CSS comment");
                };
                self.i += n + 4;
            } else if self.rest().starts_with("<!--") {
                let Some(n) = self.rest()[4..].find("-->") else {
                    return self.err("Unclosed HTML comment");
                };
                self.i += n + 7;
            } else {
                return Ok(());
            }
        }
    }

    fn block_item(&mut self) -> Result<Item, StyleError> {
        if self.byte() == b'@' {
            return Ok(Item::At(self.at_rule()?));
        }
        let save = self.i;
        let (_, term) = self.value_until()?;
        self.i = save;
        if term == b'{' {
            Ok(Item::Rule(self.rule()?))
        } else {
            Ok(Item::Decl(self.declaration()?))
        }
    }

    fn rule(&mut self) -> Result<Rule, StyleError> {
        let start = self.i;
        let selectors = self.selector_list(false)?;
        let block = self.block()?;
        Ok(Rule {
            start,
            end: block.end,
            selectors,
            block,
            parent: None,
            global_block: false,
        })
    }

    fn at_rule(&mut self) -> Result<AtRule, StyleError> {
        let start = self.i;
        self.i += 1;
        let name = self.ident()?;
        let prelude_start = self.i;
        let (prelude, term) = self.value_until()?;
        let block = if term == b'{' {
            Some(self.block()?)
        } else {
            self.i += 1;
            None
        };
        let end = block.as_ref().map_or(self.i, |x| x.end);
        Ok(AtRule {
            start,
            end,
            name,
            prelude,
            prelude_start,
            block,
        })
    }

    fn block(&mut self) -> Result<Block, StyleError> {
        if self.i >= self.src.len() || self.byte() != b'{' {
            return self.err("Expected `{`");
        }
        let start = self.i;
        self.i += 1;
        let items = self.body(Some(b'}'))?;
        if self.i >= self.src.len() {
            return self.err("Expected `}`");
        }
        self.i += 1;
        Ok(Block {
            start,
            end: self.i,
            items,
        })
    }

    fn declaration(&mut self) -> Result<Declaration, StyleError> {
        let start = self.i;
        while self.i < self.src.len() && !self.byte().is_ascii_whitespace() && self.byte() != b':' {
            self.i += 1;
        }
        let property = self.src[start..self.i].to_string();
        self.ws();
        if self.i < self.src.len() && self.byte() == b':' {
            self.i += 1;
        }
        self.ws();
        let value_start = self.i;
        let (value, term) = self.value_until()?;
        if value.is_empty() && !property.starts_with("--") {
            return self.err("CSS Declaration cannot be empty");
        }
        if term == b';' {
            self.i += 1;
        }
        Ok(Declaration {
            start,
            end_with_semicolon: self.i,
            property,
            value,
            value_start,
        })
    }

    fn value_until(&mut self) -> Result<(String, u8), StyleError> {
        let start = self.i;
        let mut quote = 0;
        let mut escaped = false;
        let mut parens = 0usize;
        while self.i < self.src.len() {
            let b = self.byte();
            if escaped {
                escaped = false;
            } else if b == b'\\' {
                escaped = true;
            } else if quote != 0 {
                if b == quote {
                    quote = 0;
                }
            } else if b == b'\'' || b == b'"' {
                quote = b;
            } else if b == b'(' {
                parens += 1;
            } else if b == b')' && parens > 0 {
                parens -= 1;
            } else if parens == 0 && matches!(b, b';' | b'{' | b'}') {
                return Ok((self.src[start..self.i].trim().to_string(), b));
            }
            self.i += 1;
        }
        self.err("Unexpected end of CSS")
    }

    fn selector_list(&mut self, in_pseudo: bool) -> Result<SelectorList, StyleError> {
        self.trivia()?;
        let start = self.i;
        let mut selectors = Vec::new();
        loop {
            selectors.push(self.complex(in_pseudo)?);
            let end = self.i;
            self.trivia()?;
            let terminal = if in_pseudo { b')' } else { b'{' };
            if self.i < self.src.len() && self.byte() == terminal {
                return Ok(SelectorList {
                    start,
                    end,
                    selectors,
                });
            }
            if self.i >= self.src.len() || self.byte() != b',' {
                return self.err("Expected `,` in selector list");
            }
            self.i += 1;
            self.trivia()?;
        }
    }

    fn complex(&mut self, in_pseudo: bool) -> Result<Complex, StyleError> {
        let start = self.i;
        let mut parts = Vec::new();
        let mut combinator = None;
        loop {
            let part_start = combinator
                .as_ref()
                .map_or(self.i, |x: &(String, usize, usize)| x.1);
            let mut simple = Vec::new();
            loop {
                if self.i >= self.src.len() {
                    return self.err("Unexpected end of selector");
                }
                let b = self.byte();
                if b == b','
                    || b == b'{'
                    || (in_pseudo && b == b')')
                    || self.rest().starts_with("||")
                    || b.is_ascii_whitespace()
                    || matches!(b, b'>' | b'+' | b'~')
                {
                    break;
                }
                if in_pseudo && let Some(end) = self.nth_prefix_end() {
                    simple.push(Simple::Other(self.i, end));
                    self.i = end;
                } else {
                    simple.push(self.simple()?);
                }
            }
            let part_end = self.i;
            if !simple.is_empty() {
                parts.push(Relative {
                    start: part_start,
                    combinator: combinator.take(),
                    simple,
                    global: false,
                    global_like: false,
                    scoped: false,
                });
            }
            let before_ws = self.i;
            self.ws();
            if self.i >= self.src.len()
                || self.byte() == b','
                || self.byte() == b'{'
                || (in_pseudo && self.byte() == b')')
            {
                return Ok(Complex {
                    start,
                    end: part_end,
                    parts,
                    used: false,
                    class_map: false,
                });
            }
            let (name, a, b) = if self.rest().starts_with("||") {
                let a = self.i;
                self.i += 2;
                let b = self.i;
                self.ws();
                ("||".into(), a, b)
            } else if matches!(self.byte(), b'>' | b'+' | b'~') {
                let a = self.i;
                let name = (self.byte() as char).to_string();
                self.i += 1;
                let b = self.i;
                self.ws();
                (name, a, b)
            } else if self.i > before_ws {
                (" ".into(), before_ws, self.i)
            } else {
                return self.err("Invalid selector");
            };
            combinator = Some((name, a, b));
        }
    }

    fn simple(&mut self) -> Result<Simple, StyleError> {
        let start = self.i;
        match self.byte() {
            b'&' => {
                self.i += 1;
                Ok(Simple::Nest(start, self.i))
            }
            b'.' | b'#' => {
                let kind = self.byte();
                self.i += 1;
                let name = self.ident()?;
                Ok(if kind == b'.' {
                    Simple::Class(name, start, self.i)
                } else {
                    Simple::Id(name, start, self.i)
                })
            }
            b'[' => self.attribute(),
            b':' => self.pseudo(),
            b'*' => {
                self.i += 1;
                Ok(Simple::Type("*".into(), start, self.i))
            }
            b if b.is_ascii_digit() => {
                while self.i < self.src.len()
                    && (self.byte().is_ascii_digit() || self.byte() == b'.' || self.byte() == b'%')
                {
                    self.i += 1;
                }
                Ok(Simple::Other(start, self.i))
            }
            _ => {
                let mut name = self.ident()?;
                if self.i < self.src.len() && self.byte() == b'|' {
                    self.i += 1;
                    name = self.ident()?;
                }
                Ok(Simple::Type(name, start, self.i))
            }
        }
    }

    /// End of the grammar's `Nth` token. It includes the whitespace after
    /// `of`, exactly like `REGEX_NTH_OF` in `@tsrx/core`.
    fn nth_prefix_end(&self) -> Option<usize> {
        let rest = self.rest();
        let lower = rest.to_ascii_lowercase();
        for keyword in ["even", "odd"] {
            if lower.starts_with(keyword) {
                let end = self.i + keyword.len();
                return nth_suffix_end(self.src, end);
            }
        }
        let bytes = self.src.as_bytes();
        let mut at = self.i;
        if at < bytes.len() && matches!(bytes[at], b'+' | b'-') {
            at += 1;
        }
        let formula_start = at;
        let mut saw_digit_or_n = false;
        while at < bytes.len() {
            let byte = bytes[at];
            if byte.is_ascii_digit() || byte.eq_ignore_ascii_case(&b'n') {
                saw_digit_or_n = true;
                at += 1;
            } else if matches!(byte, b'+' | b'-') || byte.is_ascii_whitespace() {
                at += 1;
            } else {
                break;
            }
        }
        if at == formula_start || !saw_digit_or_n {
            return None;
        }
        nth_suffix_end(self.src, at)
    }

    fn pseudo(&mut self) -> Result<Simple, StyleError> {
        let start = self.i;
        self.i += 1;
        if self.i < self.src.len() && self.byte() == b':' {
            self.i += 1;
            self.ident()?;
            if self.i < self.src.len() && self.byte() == b'(' {
                self.skip_balanced()?;
            }
            return Ok(Simple::PseudoElement(start, self.i));
        }
        let name = self.ident()?;
        let args = if self.i < self.src.len() && self.byte() == b'(' {
            self.i += 1;
            let args = self.selector_list(true)?;
            if self.i >= self.src.len() || self.byte() != b')' {
                return self.err("Expected `)`");
            }
            self.i += 1;
            Some(args)
        } else {
            None
        };
        Ok(Simple::Pseudo(Pseudo {
            start,
            end: self.i,
            name,
            args,
        }))
    }

    fn attribute(&mut self) -> Result<Simple, StyleError> {
        let start = self.i;
        self.i += 1;
        self.ws();
        let name = self.ident()?;
        self.ws();
        let op = ["~=", "^=", "$=", "*=", "|=", "="]
            .into_iter()
            .find(|op| self.rest().starts_with(op))
            .map(str::to_string);
        if let Some(op) = &op {
            self.i += op.len();
        }
        self.ws();
        let value = if op.is_some() {
            let quote = if self.i < self.src.len() && matches!(self.byte(), b'\'' | b'"') {
                let q = self.byte();
                self.i += 1;
                Some(q)
            } else {
                None
            };
            let a = self.i;
            while self.i < self.src.len()
                && quote.map_or(
                    !self.byte().is_ascii_whitespace() && self.byte() != b']',
                    |q| self.byte() != q,
                )
            {
                if self.byte() == b'\\' && self.i + 1 < self.src.len() {
                    self.i += 1;
                }
                self.i += 1;
            }
            let v = self.src[a..self.i].to_string();
            if quote.is_some() {
                self.i += 1;
            }
            Some(v)
        } else {
            None
        };
        self.ws();
        let flag_start = self.i;
        while self.i < self.src.len() && self.byte().is_ascii_alphabetic() {
            self.i += 1;
        }
        let insensitive = self.src[flag_start..self.i].contains('i');
        self.ws();
        if self.i >= self.src.len() || self.byte() != b']' {
            return self.err("Expected `]`");
        }
        self.i += 1;
        Ok(Simple::Attr(AttrSelector {
            start,
            end: self.i,
            name,
            op,
            value,
            insensitive,
        }))
    }

    fn skip_balanced(&mut self) -> Result<(), StyleError> {
        let mut depth = 0;
        while self.i < self.src.len() {
            match self.byte() {
                b'(' => depth += 1,
                b')' => {
                    depth -= 1;
                    if depth == 0 {
                        self.i += 1;
                        return Ok(());
                    }
                }
                b'\\' => self.i += 1,
                _ => {}
            }
            self.i += 1;
        }
        self.err("Expected `)`")
    }

    fn ident(&mut self) -> Result<String, StyleError> {
        let start = self.i;
        if self.i < self.src.len()
            && (self.byte().is_ascii_digit()
                || (self.byte() == b'-'
                    && self.i + 1 < self.src.len()
                    && self.src.as_bytes()[self.i + 1].is_ascii_digit()))
        {
            return self.err("Unexpected CSS identifier");
        }
        while self.i < self.src.len() {
            let b = self.byte();
            if b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-') || b >= 0x80 {
                self.i += 1;
            } else if b == b'\\' && self.i + 1 < self.src.len() {
                self.i += 2;
            } else {
                break;
            }
        }
        if self.i == start {
            return self.err("Expected identifier");
        }
        Ok(self.src[start..self.i].to_string())
    }

    fn ws(&mut self) {
        while self.i < self.src.len() && self.byte().is_ascii_whitespace() {
            self.i += 1;
        }
    }
    fn byte(&self) -> u8 {
        self.src.as_bytes()[self.i]
    }
    fn rest(&self) -> &str {
        &self.src[self.i..]
    }
}

fn nth_suffix_end(source: &str, mut end: usize) -> Option<usize> {
    let bytes = source.as_bytes();
    let formula_end = end;
    while end < bytes.len() && bytes[end].is_ascii_whitespace() {
        end += 1;
    }
    if source[end..].starts_with("of")
        && end + 2 < bytes.len()
        && bytes[end + 2].is_ascii_whitespace()
    {
        end += 2;
        while end < bytes.len() && bytes[end].is_ascii_whitespace() {
            end += 1;
        }
        return Some(end);
    }
    if end < bytes.len() && matches!(bytes[end], b',' | b')') {
        return Some(formula_end);
    }
    None
}
