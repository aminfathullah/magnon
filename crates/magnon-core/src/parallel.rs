use crate::error::MagnonError;
use crate::options::{TransformOptions, TransformResult};
use crate::transform::transform_source;
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::time::Instant;

#[derive(Debug, Serialize, Deserialize)]
pub struct BatchFileResult {
    pub path: PathBuf,
    pub success: bool,
    pub output_code: Option<String>,
    pub map: Option<String>,
    pub error: Option<String>,
    pub duration_micros: u64,
    pub bytes_read: usize,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BatchResult {
    pub total_files: usize,
    pub successful_files: usize,
    pub failed_files: usize,
    pub total_bytes: usize,
    pub wall_time_ms: f64,
    pub files: Vec<BatchFileResult>,
}

pub fn transform_files_parallel(paths: &[PathBuf], options: &TransformOptions) -> BatchResult {
    let start_all = Instant::now();

    let results: Vec<BatchFileResult> = paths
        .par_iter()
        .map(|path| {
            let start = Instant::now();
            match transform_single_file(path, options) {
                Ok((transformed, byte_count)) => BatchFileResult {
                    path: path.clone(),
                    success: true,
                    output_code: Some(transformed.code),
                    map: transformed.map,
                    error: None,
                    duration_micros: start.elapsed().as_micros() as u64,
                    bytes_read: byte_count,
                },
                Err(err) => BatchFileResult {
                    path: path.clone(),
                    success: false,
                    output_code: None,
                    map: None,
                    error: Some(err.to_string()),
                    duration_micros: start.elapsed().as_micros() as u64,
                    bytes_read: 0,
                },
            }
        })
        .collect();

    let wall_time_ms = start_all.elapsed().as_secs_f64() * 1000.0;
    let mut total_bytes = 0;
    let mut successful_files = 0;
    let mut failed_files = 0;

    for r in &results {
        total_bytes += r.bytes_read;
        if r.success {
            successful_files += 1;
        } else {
            failed_files += 1;
        }
    }

    BatchResult {
        total_files: paths.len(),
        successful_files,
        failed_files,
        total_bytes,
        wall_time_ms,
        files: results,
    }
}

fn transform_single_file(
    path: &Path,
    options: &TransformOptions,
) -> Result<(TransformResult, usize), MagnonError> {
    let content = std::fs::read_to_string(path).map_err(|source| MagnonError::Io {
        path: path.to_path_buf(),
        source,
    })?;

    let file_len = content.len();
    if file_len == 0 {
        return Ok((
            TransformResult {
                code: String::new(),
                map: None,
            },
            0,
        ));
    }

    let filename = path.to_string_lossy();
    let transformed = transform_source(&content, &filename, options)?;
    Ok((transformed, file_len))
}
