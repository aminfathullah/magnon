use std::fs;
use std::path::{Path, PathBuf};
use std::time::Instant;

use libdeflater::{CompressionLvl, Compressor};
use rayon::prelude::*;
use serde::{Deserialize, Serialize};

use crate::error::MagnonError;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompressOptions {
    pub gzip: bool,
    pub brotli: bool,
    pub gzip_level: u32,
    pub brotli_quality: u32,
    pub threshold: usize,
    pub extensions: Vec<String>,
    pub delete_original: bool,
}

impl Default for CompressOptions {
    fn default() -> Self {
        Self {
            gzip: true,
            brotli: true,
            gzip_level: 6,
            brotli_quality: 5,
            threshold: 1024,
            extensions: vec![
                "js".to_string(),
                "mjs".to_string(),
                "cjs".to_string(),
                "css".to_string(),
                "html".to_string(),
                "svg".to_string(),
                "json".to_string(),
                "wasm".to_string(),
                "txt".to_string(),
                "xml".to_string(),
            ],
            delete_original: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileCompressResult {
    pub path: String,
    pub original_size: usize,
    pub gzip_size: Option<usize>,
    pub brotli_size: Option<usize>,
    pub success: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BatchCompressResult {
    pub files: Vec<FileCompressResult>,
    pub total_files: usize,
    pub total_original_bytes: u64,
    pub total_gzip_bytes: u64,
    pub total_brotli_bytes: u64,
    pub duration_ms: f64,
}

pub fn compress_gzip(data: &[u8], level: u32) -> Result<Vec<u8>, MagnonError> {
    let lvl = CompressionLvl::new(level.min(12) as i32).map_err(|_| MagnonError::Compression {
        message: format!("Invalid gzip level: {}", level),
    })?;
    let mut compressor = Compressor::new(lvl);
    let max_len = compressor.gzip_compress_bound(data.len());
    let mut out = vec![0u8; max_len];
    let written =
        compressor
            .gzip_compress(data, &mut out)
            .map_err(|e| MagnonError::Compression {
                message: format!("Gzip failed: {:?}", e),
            })?;
    out.truncate(written);
    Ok(out)
}

pub fn compress_brotli(data: &[u8], quality: u32) -> Result<Vec<u8>, MagnonError> {
    let params = brotli::enc::BrotliEncoderParams {
        quality: quality.min(11) as i32,
        size_hint: data.len(),
        ..Default::default()
    };
    let mut input = data;
    let mut output = Vec::with_capacity(data.len() / 2);
    brotli::BrotliCompress(&mut input, &mut output, &params).map_err(|e| {
        MagnonError::Compression {
            message: format!("Brotli failed: {}", e),
        }
    })?;
    Ok(output)
}

pub fn compress_single_file(path: &Path, options: &CompressOptions) -> FileCompressResult {
    let path_str = path.to_string_lossy().to_string();

    let data = match fs::read(path) {
        Ok(d) => d,
        Err(e) => {
            return FileCompressResult {
                path: path_str,
                original_size: 0,
                gzip_size: None,
                brotli_size: None,
                success: false,
                error: Some(e.to_string()),
            };
        }
    };

    let original_size = data.len();
    if original_size < options.threshold {
        return FileCompressResult {
            path: path_str,
            original_size,
            gzip_size: None,
            brotli_size: None,
            success: true,
            error: None,
        };
    }

    let mut gzip_size = None;
    if options.gzip {
        match compress_gzip(&data, options.gzip_level) {
            Ok(gz) => {
                let gz_path = format!("{}.gz", path_str);
                if let Err(e) = fs::write(&gz_path, &gz) {
                    return FileCompressResult {
                        path: path_str,
                        original_size,
                        gzip_size: None,
                        brotli_size: None,
                        success: false,
                        error: Some(format!("Failed writing {}: {}", gz_path, e)),
                    };
                }
                gzip_size = Some(gz.len());
            }
            Err(e) => {
                return FileCompressResult {
                    path: path_str,
                    original_size,
                    gzip_size: None,
                    brotli_size: None,
                    success: false,
                    error: Some(e.to_string()),
                };
            }
        }
    }

    let mut brotli_size = None;
    if options.brotli {
        match compress_brotli(&data, options.brotli_quality) {
            Ok(br) => {
                let br_path = format!("{}.br", path_str);
                if let Err(e) = fs::write(&br_path, &br) {
                    return FileCompressResult {
                        path: path_str,
                        original_size,
                        gzip_size,
                        brotli_size: None,
                        success: false,
                        error: Some(format!("Failed writing {}: {}", br_path, e)),
                    };
                }
                brotli_size = Some(br.len());
            }
            Err(e) => {
                return FileCompressResult {
                    path: path_str,
                    original_size,
                    gzip_size,
                    brotli_size: None,
                    success: false,
                    error: Some(e.to_string()),
                };
            }
        }
    }

    if options.delete_original {
        let _ = fs::remove_file(path);
    }

    FileCompressResult {
        path: path_str,
        original_size,
        gzip_size,
        brotli_size,
        success: true,
        error: None,
    }
}

pub fn collect_compressible_files(dir: &Path, options: &CompressOptions) -> Vec<PathBuf> {
    let mut files = Vec::new();
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                files.extend(collect_compressible_files(&path, options));
            } else if path.is_file() {
                if let Some(ext) = path.extension().and_then(|s| s.to_str()) {
                    let ext_lower = ext.to_lowercase();
                    if ext_lower != "gz"
                        && ext_lower != "br"
                        && options
                            .extensions
                            .iter()
                            .any(|e| e.eq_ignore_ascii_case(&ext_lower))
                    {
                        files.push(path);
                    }
                }
            }
        }
    }
    files
}

pub fn compress_directory(dir: &Path, options: &CompressOptions) -> BatchCompressResult {
    let start = Instant::now();
    let files = collect_compressible_files(dir, options);
    compress_files_parallel(&files, options, start)
}

pub fn compress_files_parallel(
    files: &[PathBuf],
    options: &CompressOptions,
    start: Instant,
) -> BatchCompressResult {
    let results: Vec<FileCompressResult> = files
        .par_iter()
        .map(|path| compress_single_file(path, options))
        .collect();

    let mut total_original_bytes = 0u64;
    let mut total_gzip_bytes = 0u64;
    let mut total_brotli_bytes = 0u64;

    for r in &results {
        if r.success {
            total_original_bytes += r.original_size as u64;
            if let Some(sz) = r.gzip_size {
                total_gzip_bytes += sz as u64;
            }
            if let Some(sz) = r.brotli_size {
                total_brotli_bytes += sz as u64;
            }
        }
    }

    BatchCompressResult {
        total_files: results.len(),
        files: results,
        total_original_bytes,
        total_gzip_bytes,
        total_brotli_bytes,
        duration_ms: start.elapsed().as_secs_f64() * 1000.0,
    }
}
