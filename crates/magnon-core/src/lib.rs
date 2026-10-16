pub mod allocator;
pub mod error;
pub mod options;
pub mod parallel;
pub mod transform;

pub use error::MagnonError;
pub use options::{JsxRuntime, SourceType, TransformOptions, TransformResult};
pub use parallel::{transform_files_parallel, BatchFileResult, BatchResult};
pub use transform::transform_source;
