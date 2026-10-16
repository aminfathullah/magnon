#[global_allocator]
static GLOBAL: mimalloc::MiMalloc = mimalloc::MiMalloc;

use clap::{Parser, Subcommand};
use magnon_core::{
    collect_compressible_files, compress_directory, transform_files_parallel, CompressOptions,
    TransformOptions,
};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Instant;

#[derive(Parser)]
#[command(
    name = "magnon",
    version = "0.1.1",
    about = "Magnon: Ultra-high performance TypeScript/JSX compiler & parallel asset compressor in Rust"
)]
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
    Compress {
        #[arg(required = true)]
        dir: PathBuf,

        #[arg(long, default_value_t = false)]
        no_brotli: bool,

        #[arg(long, default_value_t = false)]
        no_gzip: bool,

        #[arg(long, default_value_t = 5)]
        brotli_quality: u32,

        #[arg(long, default_value_t = 6)]
        gzip_level: u32,

        #[arg(long, default_value_t = 1024)]
        threshold: usize,

        #[arg(long, default_value_t = false)]
        delete_original: bool,
    },
    Bench {
        #[arg(default_value = "src")]
        dir: PathBuf,
    },
}

fn collect_source_files(dir: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                if !entry.file_name().to_string_lossy().starts_with('.')
                    && entry.file_name() != "node_modules"
                    && entry.file_name() != "target"
                {
                    files.extend(collect_source_files(&path));
                }
            } else if let Some(ext) = path.extension().and_then(|s| s.to_str()) {
                let ext_lower = ext.to_lowercase();
                if ext_lower == "ts"
                    || ext_lower == "tsx"
                    || ext_lower == "js"
                    || ext_lower == "jsx"
                {
                    files.push(path);
                }
            }
        }
    }
    files
}

fn main() {
    let cli = Cli::parse();
    match cli.command {
        Commands::Transform { files } => {
            let options = TransformOptions::default();
            let result = transform_files_parallel(&files, &options);
            println!(
                "Transformed {}/{} files in {:.2}ms ({:.2} MB)",
                result.successful_files,
                result.total_files,
                result.wall_time_ms,
                result.total_bytes as f64 / (1024.0 * 1024.0)
            );
        }
        Commands::Compress {
            dir,
            no_brotli,
            no_gzip,
            brotli_quality,
            gzip_level,
            threshold,
            delete_original,
        } => {
            if !dir.exists() {
                eprintln!(
                    "Error: Target directory '{}' does not exist.",
                    dir.display()
                );
                std::process::exit(1);
            }

            let options = CompressOptions {
                gzip: !no_gzip,
                brotli: !no_brotli,
                gzip_level,
                brotli_quality,
                threshold,
                delete_original,
                ..Default::default()
            };

            let result = compress_directory(&dir, &options);
            println!(
                "Compressed {} assets in {:.1}ms ({:.2} MB -> gz: {:.2} MB, br: {:.2} MB)",
                result.total_files,
                result.duration_ms,
                result.total_original_bytes as f64 / (1024.0 * 1024.0),
                result.total_gzip_bytes as f64 / (1024.0 * 1024.0),
                result.total_brotli_bytes as f64 / (1024.0 * 1024.0)
            );
        }
        Commands::Bench { dir } => {
            if !dir.exists() {
                eprintln!(
                    "Error: Benchmark directory '{}' does not exist.",
                    dir.display()
                );
                std::process::exit(1);
            }

            println!("Magnon Benchmark Suite - Target: {}", dir.display());
            let files = collect_source_files(&dir);
            println!("Discovered {} source modules.", files.len());

            if !files.is_empty() {
                let options = TransformOptions::default();
                let start = Instant::now();
                let res = transform_files_parallel(&files, &options);
                let elapsed_ms = start.elapsed().as_secs_f64() * 1000.0;
                let fps = files.len() as f64 / (elapsed_ms / 1000.0);
                let mbps = (res.total_bytes as f64 / (1024.0 * 1024.0)) / (elapsed_ms / 1000.0);

                println!("\n[1] Compilation Benchmark:");
                println!("  Files:      {}/{}", res.successful_files, res.total_files);
                println!("  Wall Time:  {:.2} ms", elapsed_ms);
                println!("  Throughput: {:.1} files/sec", fps);
                println!("  Bandwidth:  {:.2} MB/s", mbps);
            }

            let comp_files = collect_compressible_files(&dir, &CompressOptions::default());
            if !comp_files.is_empty() {
                let comp_opts = CompressOptions::default();
                let comp_res = compress_directory(&dir, &comp_opts);
                let mbps = (comp_res.total_original_bytes as f64 / (1024.0 * 1024.0))
                    / (comp_res.duration_ms / 1000.0);

                println!("\n[2] Parallel Compression Benchmark:");
                println!("  Assets:     {} files", comp_res.total_files);
                println!(
                    "  Original:   {:.2} MB",
                    comp_res.total_original_bytes as f64 / (1024.0 * 1024.0)
                );
                println!(
                    "  Gzip:       {:.2} MB",
                    comp_res.total_gzip_bytes as f64 / (1024.0 * 1024.0)
                );
                println!(
                    "  Brotli:     {:.2} MB",
                    comp_res.total_brotli_bytes as f64 / (1024.0 * 1024.0)
                );
                println!("  Wall Time:  {:.1} ms", comp_res.duration_ms);
                println!("  Bandwidth:  {:.2} MB/s", mbps);
            }
        }
    }
}
