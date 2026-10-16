use std::path::PathBuf;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum MagnonError {
    #[error("IO error for file '{path}': {source}")]
    Io {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },

    #[error("Parse error in '{filename}': {message}")]
    Parse {
        filename: String,
        message: String,
    },

    #[error("Transform error in '{filename}': {message}")]
    Transform {
        filename: String,
        message: String,
    },

    #[error("UTF-8 decoding error in '{filename}': {source}")]
    Utf8 {
        filename: String,
        #[source]
        source: simdutf8::basic::Utf8Error,
    },

    #[error("Compression error: {message}")]
    Compression {
        message: String,
    },
}
