#[global_allocator]
static GLOBAL: mimalloc::MiMalloc = mimalloc::MiMalloc;

use napi::bindgen_prelude::*;
use napi_derive::napi;
use magnon_core::{
    compress_directory as core_compress_dir, compress_files_parallel as core_compress_files,
    compress_brotli as core_compress_brotli, compress_gzip as core_compress_gzip,
    transform_files_parallel, transform_source, BatchCompressResult, BatchResult, CompressOptions,
    JsxRuntime, PackageImportRule, TransformOptions, TransformResult,
};
use std::collections::HashMap;
use std::path::PathBuf;

#[napi(object)]
pub struct JsPackageImportRule {
    pub transform: String,
    pub prevent_full_import: Option<bool>,
    pub skip_default_conversion: Option<bool>,
    pub pascal_case_only: Option<bool>,
    pub include: Option<Vec<String>>,
    pub exclude: Option<Vec<String>>,
}

#[napi(object)]
pub struct JsTransformOptions {
    pub jsx_runtime: Option<String>,
    pub development: Option<bool>,
    pub refresh: Option<bool>,
    pub sourcemap: Option<bool>,
    pub optimize_package_imports: Option<Vec<String>>,
    pub modularize_imports: Option<HashMap<String, JsPackageImportRule>>,
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
    pub map: Option<String>,
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

#[napi(object)]
pub struct JsCompressOptions {
    pub gzip: Option<bool>,
    pub brotli: Option<bool>,
    pub gzip_level: Option<u32>,
    pub brotli_quality: Option<u32>,
    pub threshold: Option<u32>,
    pub extensions: Option<Vec<String>>,
    pub delete_original: Option<bool>,
}

#[napi(object)]
pub struct JsFileCompressResult {
    pub path: String,
    pub original_size: u32,
    pub gzip_size: Option<u32>,
    pub brotli_size: Option<u32>,
    pub success: bool,
    pub error: Option<String>,
}

#[napi(object)]
pub struct JsBatchCompressResult {
    pub total_files: u32,
    pub total_original_bytes: f64,
    pub total_gzip_bytes: f64,
    pub total_brotli_bytes: f64,
    pub duration_ms: f64,
    pub files: Vec<JsFileCompressResult>,
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
                    map: f.map,
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
        if let Some(pkgs) = j.optimize_package_imports {
            opts.optimize_package_imports = pkgs;
        }
        if let Some(rules) = j.modularize_imports {
            for (k, v) in rules {
                opts.modularize_imports.insert(
                    k,
                    PackageImportRule {
                        transform: v.transform,
                        prevent_full_import: v.prevent_full_import,
                        skip_default_conversion: v.skip_default_conversion,
                        pascal_case_only: v.pascal_case_only,
                        include: v.include,
                        exclude: v.exclude,
                    },
                );
            }
        }
    }
    opts
}

fn to_core_compress_options(js_opts: Option<JsCompressOptions>) -> CompressOptions {
    let mut opts = CompressOptions::default();
    if let Some(j) = js_opts {
        if let Some(gz) = j.gzip {
            opts.gzip = gz;
        }
        if let Some(br) = j.brotli {
            opts.brotli = br;
        }
        if let Some(lvl) = j.gzip_level {
            opts.gzip_level = lvl;
        }
        if let Some(q) = j.brotli_quality {
            opts.brotli_quality = q;
        }
        if let Some(t) = j.threshold {
            opts.threshold = t as usize;
        }
        if let Some(exts) = j.extensions {
            opts.extensions = exts;
        }
        if let Some(del) = j.delete_original {
            opts.delete_original = del;
        }
    }
    opts
}

fn to_js_batch_compress_result(res: BatchCompressResult) -> JsBatchCompressResult {
    JsBatchCompressResult {
        total_files: res.total_files as u32,
        total_original_bytes: res.total_original_bytes as f64,
        total_gzip_bytes: res.total_gzip_bytes as f64,
        total_brotli_bytes: res.total_brotli_bytes as f64,
        duration_ms: res.duration_ms,
        files: res
            .files
            .into_iter()
            .map(|f| JsFileCompressResult {
                path: f.path,
                original_size: f.original_size as u32,
                gzip_size: f.gzip_size.map(|s| s as u32),
                brotli_size: f.brotli_size.map(|s| s as u32),
                success: f.success,
                error: f.error,
            })
            .collect(),
    }
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

#[napi]
pub fn compress_gzip(data: Buffer, level: Option<u32>) -> Result<Buffer> {
    core_compress_gzip(&data, level.unwrap_or(6))
        .map(Buffer::from)
        .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))
}

#[napi]
pub fn compress_brotli(data: Buffer, quality: Option<u32>) -> Result<Buffer> {
    core_compress_brotli(&data, quality.unwrap_or(5))
        .map(Buffer::from)
        .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))
}

#[napi]
pub fn compress_directory(
    dir_path: String,
    options: Option<JsCompressOptions>,
) -> Result<JsBatchCompressResult> {
    let opts = to_core_compress_options(options);
    let path = std::path::Path::new(&dir_path);
    let res = core_compress_dir(path, &opts);
    Ok(to_js_batch_compress_result(res))
}

#[napi]
pub fn compress_files(
    files: Vec<String>,
    options: Option<JsCompressOptions>,
) -> Result<JsBatchCompressResult> {
    let opts = to_core_compress_options(options);
    let paths: Vec<PathBuf> = files.into_iter().map(PathBuf::from).collect();
    let res = core_compress_files(&paths, &opts, std::time::Instant::now());
    Ok(to_js_batch_compress_result(res))
}
