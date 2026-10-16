#[global_allocator]
static GLOBAL: mimalloc::MiMalloc = mimalloc::MiMalloc;

use napi::bindgen_prelude::*;
use napi_derive::napi;
use magnon_core::{
    transform_files_parallel, transform_source, BatchResult, JsxRuntime, TransformOptions,
    TransformResult,
};
use std::path::PathBuf;

#[napi(object)]
pub struct JsTransformOptions {
    pub jsx_runtime: Option<String>,
    pub development: Option<bool>,
    pub refresh: Option<bool>,
    pub sourcemap: Option<bool>,
}

#[napi(object)]
pub struct JsTransformResult {
    pub code: String,
    pub map: Option<String>,
}

#[napi(object)]
pub struct JsBatchFileResult {
    pub path: String,
    pub success: bool,
    pub output_code: Option<String>,
    pub error: Option<String>,
    pub duration_micros: u32,
    pub bytes_read: u32,
}

#[napi(object)]
pub struct JsBatchResult {
    pub total_files: u32,
    pub successful_files: u32,
    pub failed_files: u32,
    pub total_bytes: u32,
    pub wall_time_ms: f64,
    pub files: Vec<JsBatchFileResult>,
}

impl From<TransformResult> for JsTransformResult {
    fn from(res: TransformResult) -> Self {
        Self {
            code: res.code,
            map: res.map,
        }
    }
}

impl From<BatchResult> for JsBatchResult {
    fn from(res: BatchResult) -> Self {
        Self {
            total_files: res.total_files as u32,
            successful_files: res.successful_files as u32,
            failed_files: res.failed_files as u32,
            total_bytes: res.total_bytes as u32,
            wall_time_ms: res.wall_time_ms,
            files: res
                .files
                .into_iter()
                .map(|f| JsBatchFileResult {
                    path: f.path.to_string_lossy().to_string(),
                    success: f.success,
                    output_code: f.output_code,
                    error: f.error,
                    duration_micros: f.duration_micros as u32,
                    bytes_read: f.bytes_read as u32,
                })
                .collect(),
        }
    }
}

fn to_core_options(js_opts: Option<JsTransformOptions>) -> TransformOptions {
    let mut opts = TransformOptions::default();
    if let Some(j) = js_opts {
        if let Some(runtime) = j.jsx_runtime {
            opts.jsx_runtime = match runtime.to_lowercase().as_str() {
                "classic" => JsxRuntime::Classic,
                _ => JsxRuntime::Automatic,
            };
        }
        if let Some(dev) = j.development {
            opts.development = dev;
        }
        if let Some(refresh) = j.refresh {
            opts.refresh = refresh;
        }
        if let Some(sm) = j.sourcemap {
            opts.sourcemap = sm;
        }
    }
    opts
}

#[napi]
pub fn transform(
    code: String,
    filename: String,
    options: Option<JsTransformOptions>,
) -> Result<JsTransformResult> {
    let core_opts = to_core_options(options);
    transform_source(&code, &filename, &core_opts)
        .map(Into::into)
        .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))
}

#[napi]
pub fn transform_batch(
    files: Vec<String>,
    options: Option<JsTransformOptions>,
) -> Result<JsBatchResult> {
    let core_opts = to_core_options(options);
    let paths: Vec<PathBuf> = files.into_iter().map(PathBuf::from).collect();
    let result = transform_files_parallel(&paths, &core_opts);
    Ok(result.into())
}
