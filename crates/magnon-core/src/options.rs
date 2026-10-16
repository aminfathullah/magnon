use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum JsxRuntime {
    Automatic,
    Classic,
}

impl Default for JsxRuntime {
    fn default() -> Self {
        Self::Automatic
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransformOptions {
    pub jsx_runtime: JsxRuntime,
    pub development: bool,
    pub refresh: bool,
    pub sourcemap: bool,
    pub target_es2022: bool,
}

impl Default for TransformOptions {
    fn default() -> Self {
        Self {
            jsx_runtime: JsxRuntime::Automatic,
            development: false,
            refresh: false,
            sourcemap: false,
            target_es2022: true,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SourceType {
    Js,
    Jsx,
    Ts,
    Tsx,
}

impl SourceType {
    pub fn from_path<P: AsRef<Path>>(path: P) -> Self {
        let path = path.as_ref();
        match path.extension().and_then(|ext| ext.to_str()) {
            Some("tsx") => Self::Tsx,
            Some("ts") | Some("mts") | Some("cts") => Self::Ts,
            Some("jsx") => Self::Jsx,
            _ => Self::Js,
        }
    }

    pub fn is_jsx(&self) -> bool {
        matches!(self, Self::Jsx | Self::Tsx)
    }

    pub fn is_typescript(&self) -> bool {
        matches!(self, Self::Ts | Self::Tsx)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransformResult {
    pub code: String,
    pub map: Option<String>,
}
