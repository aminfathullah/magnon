use serde::{Deserialize, Serialize};
use std::collections::HashMap;
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
pub struct PackageImportRule {
    pub transform: String,
    pub prevent_full_import: Option<bool>,
    pub skip_default_conversion: Option<bool>,
    pub pascal_case_only: Option<bool>,
    pub include: Option<Vec<String>>,
    pub exclude: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransformOptions {
    pub jsx_runtime: JsxRuntime,
    pub development: bool,
    pub refresh: bool,
    pub sourcemap: bool,
    pub target_es2022: bool,
    pub optimize_package_imports: Vec<String>,
    pub modularize_imports: HashMap<String, PackageImportRule>,
}

impl Default for TransformOptions {
    fn default() -> Self {
        Self {
            jsx_runtime: JsxRuntime::Automatic,
            development: false,
            refresh: false,
            sourcemap: false,
            target_es2022: true,
            optimize_package_imports: Vec::new(),
            modularize_imports: HashMap::new(),
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
        let path_str = path.to_string_lossy();
        let clean_path = path_str.split('?').next().unwrap_or(&path_str);
        let clean_path = clean_path.split('#').next().unwrap_or(clean_path);
        let p = Path::new(clean_path);
        match p.extension().and_then(|ext| ext.to_str()) {
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
