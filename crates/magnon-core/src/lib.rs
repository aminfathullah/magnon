pub mod allocator;
pub mod compress;
pub mod error;
pub mod modularize;
pub mod options;
pub mod parallel;
pub mod transform;

pub use compress::{
    collect_compressible_files, compress_brotli, compress_directory, compress_files_parallel,
    compress_gzip, compress_single_file, BatchCompressResult, CompressOptions, FileCompressResult,
};
pub use error::MagnonError;
pub use modularize::optimize_program_imports;
pub use options::{
    JsxRuntime, PackageImportRule, SourceType, TransformOptions, TransformResult,
};
pub use parallel::{transform_files_parallel, BatchFileResult, BatchResult};
pub use transform::transform_source;
