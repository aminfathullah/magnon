#[global_allocator]
static GLOBAL: mimalloc::MiMalloc = mimalloc::MiMalloc;

use clap::{Parser, Subcommand};
use magnon_core::{transform_files_parallel, TransformOptions};
use std::path::PathBuf;

#[derive(Parser)]
#[command(name = "magnon", version = "0.1.0", about = "Magnon: Ultra-high performance TypeScript/JSX compiler in Rust")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    Transform {
        #[arg(required = true)]
        files: Vec<PathBuf>,
    },
}

fn main() {
    let cli = Cli::parse();
    match cli.command {
        Commands::Transform { files } => {
            let options = TransformOptions::default();
            let result = transform_files_parallel(&files, &options);
            println!(
                "Transformed {} files in {:.2}ms ({} bytes)",
                result.successful_files, result.wall_time_ms, result.total_bytes
            );
        }
    }
}
