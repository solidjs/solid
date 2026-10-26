//! Solid's Oxc JSX compiler.
//!
//! The crate exposes two surfaces: the Node/N-API `transform()` interface
//! (behind the default `node` feature) that `@solidjs/compiler`
//! ships, and a host-independent Rust [`compile`] API for embedding the
//! compiler directly.
//!
//! # Stability
//!
//! The Rust API (`compile`, [`style`], [`CompileOptions`], [`CompileOutput`],
//! [`CompileError`]) is **unstable**. The compiler is pre-1.0 and under
//! active development; this surface carries no semver commitment and may
//! change shape in any release while the compiler churns. Pin an exact
//! revision when embedding it. The Node `transform()` interface remains the
//! supported public contract.

mod compiler;
#[cfg(feature = "node")]
mod config;
#[cfg(feature = "node")]
mod directives;
mod dom;
mod error;
#[cfg(feature = "node")]
mod lazy;
#[cfg(feature = "node")]
mod node_adapter;
#[cfg(feature = "node")]
mod refresh;
mod shared;
#[cfg(feature = "node")]
mod source_names;
mod ssr;
#[cfg(feature = "tsrx")]
mod tsrx;
mod universal;

pub use compiler::{
    CompileOptions, CompileOutput, Generate, Renderer, SourceNames, Syntax, Wrapper, compile,
};
pub use error::{CompileError, CompileErrorKind};
#[cfg(feature = "tsrx")]
pub use tsrx::{
    TsrxEmbeddedRegion, TsrxEmbeddedRegionKind, TsrxTypecheckMapping, TsrxTypecheckProjection,
    TsrxTypecheckProjectionOptions, project_tsrx_for_typecheck,
};

/// TSRX's scoped-CSS engine, for frontends other than TSRX.
///
/// [`compile_style`](style::compile_style) has no dependency on the TSRX
/// syntax or on Oxc: a frontend describes the elements a `<style>` block
/// governs as [`Element`](style::Element) values and gets back the scoped
/// stylesheet, its hash, the class map, and which elements to annotate with
/// the hash — the same bytes a `.tsrx` file with that stylesheet at that
/// [`StyleLocation`](style::StyleLocation) gets.
#[cfg(feature = "tsrx")]
pub mod style {
    pub use crate::tsrx::style::{
        Attribute, AttributeValue, ClassMapEntry, Element, ElementChild, ElementKind, StyleError,
        StyleInput, StyleKind, StyleLocation, StyleOutput, compile_style,
        compile_style_with_class_map_selectors,
    };
}

#[cfg(feature = "node")]
pub use node_adapter::*;
