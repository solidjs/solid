use std::fmt;

/// The stage at which compilation failed.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CompileErrorKind {
    Parse,
    Configuration,
    Transform,
}

/// An owned compiler error that does not expose Oxc or host-adapter types.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CompileError {
    kind: CompileErrorKind,
    message: String,
}

impl CompileError {
    #[must_use]
    pub fn parse(message: impl Into<String>) -> Self {
        Self::new(CompileErrorKind::Parse, message)
    }

    #[must_use]
    pub fn configuration(message: impl Into<String>) -> Self {
        Self::new(CompileErrorKind::Configuration, message)
    }

    #[must_use]
    pub fn transform(message: impl Into<String>) -> Self {
        Self::new(CompileErrorKind::Transform, message)
    }

    /// Compatibility constructor used by transform internals.
    #[must_use]
    pub(crate) fn from_reason(message: impl Into<String>) -> Self {
        Self::transform(message)
    }

    #[must_use]
    pub fn kind(&self) -> CompileErrorKind {
        self.kind
    }

    #[must_use]
    pub fn message(&self) -> &str {
        &self.message
    }

    fn new(kind: CompileErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
        }
    }
}

impl fmt::Display for CompileError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for CompileError {}

pub(crate) type Error = CompileError;
pub(crate) type Result<T> = std::result::Result<T, CompileError>;
