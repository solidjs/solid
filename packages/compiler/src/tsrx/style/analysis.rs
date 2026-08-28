use super::render::{strip_prefix, unescape_ident};
use super::*;

pub(super) fn analyze_items(items: &mut [Item], parent: Option<usize>) -> Result<(), StyleError> {
    analyze_items_inner(items, parent)
}

fn analyze_items_inner(items: &mut [Item], parent: Option<usize>) -> Result<(), StyleError> {
    for item in items {
        match item {
            Item::Rule(rule) => {
                rule.parent = parent;
                for complex in &mut rule.selectors.selectors {
                    let mut after_global = false;
                    for (index, relative) in complex.parts.iter_mut().enumerate() {
                        if after_global {
                            relative.global_like = true;
                        }
                        let global_index = relative.simple.iter().position(is_bare_global);
                        if index == 0 && global_index == Some(0) {
                            rule.global_block = true;
                        }
                        if global_index == Some(0) {
                            after_global = true;
                        }
                        relative.global = relative_is_global(relative);
                        relative.global_like |= relative.simple.iter().all(|simple| {
                            matches!(simple, Simple::Pseudo(_) | Simple::PseudoElement(..))
                                && matches!(
                                    simple,
                                    Simple::Pseudo(Pseudo { name, .. }) if name == "root" || name == "host"
                                )
                        });
                        analyze_pseudos(&mut relative.simple)?;
                    }
                    complex.used = complex.parts.iter().all(|p| p.global || p.global_like);
                    if let Some(index) = complex.parts.iter().position(relative_is_global)
                        && index != 0
                        && index + 1 != complex.parts.len()
                        && complex.parts[index + 1..]
                            .iter()
                            .any(|part| !relative_is_global(part))
                    {
                        return Err(StyleError {
                            message: ":global(...) can be at the start or end of a selector sequence, but not in the middle.".into(),
                            offset: complex.parts[index].start,
                        });
                    }
                }
                let ptr = rule as *const Rule as usize;
                analyze_items_inner(&mut rule.block.items, Some(ptr))?;
            }
            Item::At(at) => {
                if let Some(block) = &mut at.block {
                    analyze_items_inner(&mut block.items, parent)?;
                }
            }
            Item::Decl(_) => {}
        }
    }
    Ok(())
}

fn analyze_pseudos(simple: &mut [Simple]) -> Result<(), StyleError> {
    for selector in simple {
        let Simple::Pseudo(pseudo) = selector else {
            continue;
        };
        if let Some(args) = &mut pseudo.args {
            for complex in &mut args.selectors {
                for relative in &mut complex.parts {
                    relative.global = relative_is_global(relative);
                    relative.global_like = relative.simple.iter().all(|simple| {
                        matches!(
                            simple,
                            Simple::Pseudo(Pseudo { name, .. }) if name == "root" || name == "host"
                        )
                    });
                    analyze_pseudos(&mut relative.simple)?;
                }
                complex.used = complex.parts.iter().all(|x| x.global || x.global_like);
            }
            if pseudo.name == "global"
                && args.selectors.iter().any(|complex| {
                    complex
                        .parts
                        .iter()
                        .any(|part| part.simple.iter().any(is_bare_global))
                })
            {
                return Err(StyleError {
                    message: "A :global selector cannot be inside a pseudoclass.".into(),
                    offset: pseudo.start,
                });
            }
        }
    }
    Ok(())
}

fn is_bare_global(simple: &Simple) -> bool {
    matches!(simple, Simple::Pseudo(Pseudo { name, args: None, .. }) if name == "global")
}

fn relative_is_global(relative: &Relative) -> bool {
    let Some(Simple::Pseudo(first)) = relative.simple.first() else {
        return false;
    };
    first.name == "global"
        && (first.args.is_none()
            || relative
                .simple
                .iter()
                .all(|x| matches!(x, Simple::Pseudo(_) | Simple::PseudoElement(..))))
}

pub(super) fn collect_class_map(
    items: &mut [Item],
    entries: &mut BTreeMap<String, (usize, usize)>,
) {
    for item in items {
        match item {
            Item::Rule(rule) => {
                for complex in &mut rule.selectors.selectors {
                    collect_complex_classes(complex, entries);
                }
                collect_class_map(&mut rule.block.items, entries);
            }
            Item::At(at) => {
                if let Some(block) = &mut at.block {
                    collect_class_map(&mut block.items, entries);
                }
            }
            Item::Decl(_) => {}
        }
    }
}

fn collect_complex_classes(
    complex: &mut Complex,
    entries: &mut BTreeMap<String, (usize, usize)>,
) -> bool {
    let mut contains_class_map_selector = false;
    if complex.parts.len() == 1 {
        let relative = &complex.parts[0];
        if !relative.global
            && !relative.global_like
            && relative.simple.len() == 1
            && let Simple::Class(name, start, end) = &relative.simple[0]
        {
            contains_class_map_selector = true;
            entries
                .entry(unescape_ident(name))
                .or_insert((*start, *end));
        }
    }
    for part in &mut complex.parts {
        for simple in &mut part.simple {
            if let Simple::Pseudo(Pseudo {
                args: Some(args), ..
            }) = simple
            {
                for child in &mut args.selectors {
                    contains_class_map_selector |= collect_complex_classes(child, entries);
                }
            }
        }
    }
    complex.class_map |= contains_class_map_selector;
    contains_class_map_selector
}

pub(super) fn prepare_expression(items: &mut [Item]) {
    fn walk(items: &mut [Item], nested_rule: bool) {
        for item in items {
            match item {
                Item::Rule(rule) => {
                    for complex in &mut rule.selectors.selectors {
                        complex.used = nested_rule || complex.class_map || rule.global_block;
                        mark_scoped(complex);
                    }
                    walk(&mut rule.block.items, true);
                }
                Item::At(at) => {
                    if let Some(block) = &mut at.block {
                        walk(&mut block.items, nested_rule);
                    }
                }
                Item::Decl(_) => {}
            }
        }
    }
    walk(items, false);
}

pub(super) fn preserve_class_map(items: &mut [Item]) {
    for item in items {
        match item {
            Item::Rule(rule) => {
                for complex in &mut rule.selectors.selectors {
                    if complex.class_map {
                        complex.used = true;
                        mark_scoped(complex);
                    }
                }
                preserve_class_map(&mut rule.block.items);
            }
            Item::At(at) => {
                if let Some(block) = &mut at.block {
                    preserve_class_map(&mut block.items);
                }
            }
            Item::Decl(_) => {}
        }
    }
}

fn mark_scoped(complex: &mut Complex) {
    for part in &mut complex.parts {
        if !part.global {
            part.scoped = true;
        }
        for simple in &mut part.simple {
            if let Simple::Pseudo(Pseudo {
                args: Some(args),
                name,
                ..
            }) = simple
                && matches!(name.as_str(), "is" | "where" | "has" | "not" | "global")
            {
                for child in &mut args.selectors {
                    mark_scoped(child);
                }
            }
        }
    }
}

#[derive(Clone)]
struct FlatElement<'a> {
    element: &'a Element,
    parent: Option<usize>,
    children: Vec<usize>,
    siblings: Vec<usize>,
    position: usize,
}

pub(super) struct Arena<'a> {
    nodes: Vec<FlatElement<'a>>,
    has_dynamic: bool,
}

impl<'a> Arena<'a> {
    pub(super) fn from_roots(roots: &'a [Element]) -> Self {
        let mut arena = Self {
            nodes: Vec::new(),
            has_dynamic: false,
        };
        let root_indexes: Vec<_> = roots
            .iter()
            .map(|element| arena.add(element, None))
            .collect();
        for (position, index) in root_indexes.iter().copied().enumerate() {
            arena.nodes[index].siblings = root_indexes.clone();
            arena.nodes[index].position = position;
        }
        arena
    }

    pub(super) fn len(&self) -> usize {
        self.nodes.len()
    }

    fn add(&mut self, element: &'a Element, parent: Option<usize>) -> usize {
        let index = self.nodes.len();
        self.nodes.push(FlatElement {
            element,
            parent,
            children: Vec::new(),
            siblings: Vec::new(),
            position: 0,
        });
        let child_indexes: Vec<_> = element
            .children
            .iter()
            .filter_map(|child| match child {
                ElementChild::Element(child) => Some(self.add(child, Some(index))),
                ElementChild::Dynamic => {
                    self.has_dynamic = true;
                    None
                }
            })
            .collect();
        for (position, child) in child_indexes.iter().copied().enumerate() {
            self.nodes[child].siblings = child_indexes.clone();
            self.nodes[child].position = position;
        }
        self.nodes[index].children = child_indexes;
        index
    }
}

pub(super) fn prune_items(
    items: &mut [Item],
    arena: &Arena<'_>,
    element: usize,
    scoped: &mut BTreeSet<u32>,
    parent_selectors: Option<Vec<Complex>>,
) {
    for item in items {
        match item {
            Item::Rule(rule) => {
                let mut effective = Vec::new();
                let has_animation = rule_has_animation(rule);
                for complex in &mut rule.selectors.selectors {
                    let matched = matches_complex(complex, arena, element, &parent_selectors);
                    if matched || has_animation {
                        complex.used = true;
                        scope_matching_parts(complex, scoped, arena.nodes[element].element.id);
                    }
                    effective.push(complex.clone());
                }
                prune_items(
                    &mut rule.block.items,
                    arena,
                    element,
                    scoped,
                    Some(effective),
                );
            }
            Item::At(at) => {
                if let Some(block) = &mut at.block {
                    prune_items(
                        block.items.as_mut_slice(),
                        arena,
                        element,
                        scoped,
                        parent_selectors.clone(),
                    );
                }
            }
            Item::Decl(_) => {}
        }
    }
}

fn rule_has_animation(rule: &Rule) -> bool {
    rule.block.items.iter().any(|item| {
        matches!(
            item,
            Item::Decl(Declaration { property, .. })
                if matches!(strip_prefix(property).as_str(), "animation" | "animation-name")
        )
    })
}

fn scope_matching_parts(complex: &mut Complex, scoped: &mut BTreeSet<u32>, id: u32) {
    for part in &mut complex.parts {
        if part.scoped {
            scoped.insert(id);
        }
        for simple in &mut part.simple {
            if let Simple::Pseudo(Pseudo {
                args: Some(args),
                name,
                ..
            }) = simple
                && matches!(name.as_str(), "is" | "where" | "has")
            {
                for child in &mut args.selectors {
                    if child.used {
                        scope_matching_parts(child, scoped, id);
                    }
                }
            }
        }
    }
}

fn matches_complex(
    complex: &mut Complex,
    arena: &Arena<'_>,
    element: usize,
    parent: &Option<Vec<Complex>>,
) -> bool {
    if arena.has_dynamic {
        return true;
    }
    let Some(last_local) = complex
        .parts
        .iter()
        .rposition(|part| !part.global && !part.global_like)
    else {
        return true;
    };
    match_at(complex, last_local, arena, element, parent)
}

fn match_at(
    complex: &mut Complex,
    part: usize,
    arena: &Arena<'_>,
    element: usize,
    parent: &Option<Vec<Complex>>,
) -> bool {
    if !compound_matches(&mut complex.parts[part], arena, element, parent) {
        return false;
    }
    let matched = if part == 0 {
        true
    } else {
        let combinator = complex.parts[part]
            .combinator
            .as_ref()
            .map(|x| x.0.as_str())
            .unwrap_or(" ")
            .to_string();
        match combinator.as_str() {
            ">" => arena.nodes[element]
                .parent
                .is_some_and(|parent_el| match_at(complex, part - 1, arena, parent_el, parent)),
            " " => {
                let mut ancestor = arena.nodes[element].parent;
                let mut found = false;
                while let Some(index) = ancestor {
                    if match_at(complex, part - 1, arena, index, parent) {
                        found = true;
                        break;
                    }
                    ancestor = arena.nodes[index].parent;
                }
                found
                    || complex.parts[..part]
                        .iter()
                        .all(|part| part.global || part.global_like)
            }
            "+" => {
                let node = &arena.nodes[element];
                node.position > 0
                    && match_at(
                        complex,
                        part - 1,
                        arena,
                        node.siblings[node.position - 1],
                        parent,
                    )
            }
            "~" => {
                let node = &arena.nodes[element];
                node.siblings[..node.position]
                    .iter()
                    .copied()
                    .any(|sibling| match_at(complex, part - 1, arena, sibling, parent))
            }
            // `@tsrx/core` deliberately treats unknown combinators, including
            // the column combinator, as a possible match without traversing
            // the selector on its other side.
            _ => true,
        }
    };
    if matched && !complex.parts[part].global && !complex.parts[part].global_like {
        complex.parts[part].scoped = true;
    }
    matched
}

fn compound_matches(
    relative: &mut Relative,
    arena: &Arena<'_>,
    index: usize,
    parent: &Option<Vec<Complex>>,
) -> bool {
    if relative.global || relative.global_like {
        return true;
    }
    let element = arena.nodes[index].element;
    for simple in &mut relative.simple {
        let matches = match simple {
            Simple::Type(name, ..) => match &element.kind {
                ElementKind::Native(tag) => name == "*" || tag.eq_ignore_ascii_case(name),
                ElementKind::Dynamic => true,
                ElementKind::Component => name == "*",
            },
            Simple::Class(name, ..) => attr_matches(
                element,
                "class",
                Some(&unescape_ident(name)),
                Some("~="),
                false,
            ),
            Simple::Id(name, ..) => {
                attr_matches(element, "id", Some(&unescape_ident(name)), Some("="), false)
            }
            Simple::Attr(attr) => {
                whitelisted_attr(element, &attr.name)
                    || attr_matches(
                        element,
                        &attr.name,
                        attr.value.as_deref(),
                        attr.op.as_deref(),
                        attr.insensitive,
                    )
            }
            Simple::Pseudo(pseudo) if pseudo.name == "root" || pseudo.name == "host" => false,
            Simple::Pseudo(pseudo) if pseudo.name == "global" => {
                if let Some(args) = &mut pseudo.args {
                    args.selectors
                        .iter_mut()
                        .any(|complex| matches_complex(complex, arena, index, parent))
                } else {
                    true
                }
            }
            Simple::Pseudo(pseudo)
                if matches!(pseudo.name.as_str(), "is" | "where" | "has" | "not") =>
            {
                let Some(args) = &mut pseudo.args else {
                    continue;
                };
                if pseudo.name == "has" {
                    let descendants = descendants(arena, index);
                    args.selectors.iter_mut().any(|complex| {
                        descendants.iter().copied().any(|descendant| {
                            let matched = matches_complex(complex, arena, descendant, parent);
                            complex.used |= matched;
                            matched
                        })
                    })
                } else if pseudo.name == "not" {
                    for complex in &mut args.selectors {
                        complex.used = true;
                    }
                    true
                } else {
                    args.selectors.iter_mut().any(|complex| {
                        let matched = matches_complex(complex, arena, index, parent);
                        complex.used |= matched;
                        matched
                    })
                }
            }
            Simple::Nest(..) => parent.as_ref().is_none_or(|parents| {
                parents
                    .iter()
                    .cloned()
                    .any(|mut complex| matches_complex(&mut complex, arena, index, &None))
            }),
            _ => true,
        };
        if !matches {
            return false;
        }
    }
    true
}

fn descendants(arena: &Arena<'_>, root: usize) -> Vec<usize> {
    let mut out = Vec::new();
    let mut stack = arena.nodes[root].children.clone();
    while let Some(index) = stack.pop() {
        out.push(index);
        stack.extend(arena.nodes[index].children.iter().copied());
    }
    out
}

fn attr_matches(
    element: &Element,
    name: &str,
    expected: Option<&str>,
    op: Option<&str>,
    insensitive: bool,
) -> bool {
    if element.has_spread {
        return true;
    }
    for attr in &element.attributes {
        let accepted = attr.name.eq_ignore_ascii_case(name)
            || attr.name.eq_ignore_ascii_case(&format!("${name}"))
            || (name.eq_ignore_ascii_case("class") && attr.name.eq_ignore_ascii_case("className"));
        if !accepted {
            continue;
        }
        let Some(expected) = expected else {
            return true;
        };
        let Some(AttributeValue::Static(actual)) = &attr.value else {
            return true;
        };
        let (mut expected, mut actual) = (expected.to_string(), actual.to_string());
        if insensitive {
            expected.make_ascii_lowercase();
            actual.make_ascii_lowercase();
        }
        return match op {
            Some("=") => actual == expected,
            Some("~=") => actual.split_whitespace().any(|x| x == expected),
            Some("|=") => actual == expected || actual.starts_with(&format!("{expected}-")),
            Some("^=") => actual.starts_with(&expected),
            Some("$=") => actual.ends_with(&expected),
            Some("*=") => actual.contains(&expected),
            _ => true,
        };
    }
    false
}

fn whitelisted_attr(element: &Element, attr: &str) -> bool {
    let ElementKind::Native(tag) = &element.kind else {
        return false;
    };
    matches!(
        (
            tag.to_ascii_lowercase().as_str(),
            attr.to_ascii_lowercase().as_str()
        ),
        ("details" | "dialog", "open")
            | ("form", "novalidate")
            | (
                "iframe",
                "allow" | "allowfullscreen" | "allowpaymentrequest" | "loading" | "referrerpolicy"
            )
            | ("img", "loading")
            | (
                "input",
                "accept"
                    | "autocomplete"
                    | "capture"
                    | "checked"
                    | "disabled"
                    | "max"
                    | "maxlength"
                    | "min"
                    | "minlength"
                    | "multiple"
                    | "pattern"
                    | "placeholder"
                    | "readonly"
                    | "required"
                    | "size"
                    | "step"
            )
            | ("object", "typemustmatch")
            | ("ol", "reversed" | "start" | "type")
            | ("optgroup", "disabled")
            | ("option", "selected" | "disabled")
            | ("script", "async" | "defer" | "nomodule" | "type")
            | ("select", "disabled" | "required" | "multiple" | "size")
            | (
                "textarea",
                "autocomplete"
                    | "disabled"
                    | "maxlength"
                    | "minlength"
                    | "placeholder"
                    | "readonly"
                    | "required"
                    | "rows"
                    | "wrap"
            )
            | (
                "video",
                "autoplay" | "controls" | "loop" | "muted" | "playsinline"
            )
    )
}

pub(super) fn collect_keyframes(items: &[Item]) -> BTreeSet<String> {
    fn walk(items: &[Item], global: bool, out: &mut BTreeSet<String>) {
        for item in items {
            match item {
                Item::At(at) if strip_prefix(&at.name) == "keyframes" => {
                    if !global && !at.prelude.starts_with("-global-") {
                        out.insert(at.prelude.clone());
                    }
                }
                Item::At(at) => {
                    if let Some(block) = &at.block {
                        walk(&block.items, global, out);
                    }
                }
                Item::Rule(rule) => walk(&rule.block.items, global || rule.global_block, out),
                Item::Decl(_) => {}
            }
        }
    }
    let mut out = BTreeSet::new();
    walk(items, false, &mut out);
    out
}
