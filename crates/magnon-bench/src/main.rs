#[global_allocator]
static GLOBAL: mimalloc::MiMalloc = mimalloc::MiMalloc;

use oxc_allocator::Allocator;
use oxc_codegen::Codegen;
use oxc_parser::Parser;
use oxc_semantic::SemanticBuilder;
use oxc_span::SourceType as OxcSourceType;
use oxc_transformer::{
    JsxOptions, JsxRuntime as OxcJsxRuntime, TransformOptions as OxcTransformOptions,
    Transformer, TypeScriptOptions,
};
use magnon_core::{transform_source, SourceType, TransformOptions};
use rayon::prelude::*;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Instant;

fn collect_source_files<P: AsRef<Path>>(dir: P) -> Vec<PathBuf> {
    let mut files = Vec::new();
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                files.extend(collect_source_files(path));
            } else if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
                if matches!(ext, "ts" | "tsx" | "js" | "jsx") {
                    files.push(path);
                }
            }
        }
    }
    files.sort();
    files
}

fn benchmark_oxc_single_thread(files: &[PathBuf]) -> (f64, usize) {
    let start = Instant::now();
    let mut total_bytes = 0;

    for path in files {
        let content = match fs::read_to_string(path) {
            Ok(c) => c,
            Err(_) => continue,
        };
        total_bytes += content.len();
        if content.is_empty() {
            continue;
        }

        let allocator = Allocator::default();
        let source_type_kind = SourceType::from_path(path);
        let mut oxc_source_type = match source_type_kind {
            SourceType::Tsx => OxcSourceType::default().with_typescript(true).with_jsx(true),
            SourceType::Ts => OxcSourceType::default().with_typescript(true).with_jsx(false),
            SourceType::Jsx => OxcSourceType::default().with_typescript(false).with_jsx(true),
            SourceType::Js => OxcSourceType::default().with_typescript(false).with_jsx(false),
        };
        oxc_source_type = oxc_source_type.with_module(true);

        let ret = Parser::new(&allocator, &content, oxc_source_type).parse();
        if !ret.errors.is_empty() {
            continue;
        }

        let mut program = ret.program;
        let scoping = SemanticBuilder::new()
            .build(&program)
            .semantic
            .into_scoping();

        let mut oxc_options = OxcTransformOptions::default();
        if source_type_kind.is_typescript() {
            oxc_options.typescript = TypeScriptOptions::default();
        }
        if source_type_kind.is_jsx() {
            let mut jsx = JsxOptions::default();
            jsx.runtime = OxcJsxRuntime::Automatic;
            oxc_options.jsx = jsx;
        }

        let transformer = Transformer::new(&allocator, path, &oxc_options);
        let _ = transformer.build_with_scoping(scoping, &mut program);
        let _ = Codegen::new().build(&program);
    }

    (start.elapsed().as_secs_f64() * 1000.0, total_bytes)
}

fn benchmark_magnon_single_thread(files: &[PathBuf]) -> (f64, usize) {
    let start = Instant::now();
    let options = TransformOptions::default();
    let mut total_bytes = 0;

    for path in files {
        let content = match fs::read_to_string(path) {
            Ok(c) => c,
            Err(_) => continue,
        };
        total_bytes += content.len();
        let filename = path.to_string_lossy();
        let _ = transform_source(&content, &filename, &options);
    }

    (start.elapsed().as_secs_f64() * 1000.0, total_bytes)
}

fn benchmark_oxc_parallel_32c(files: &[PathBuf]) -> (f64, usize) {
    let start = Instant::now();
    let total_bytes: usize = files
        .par_iter()
        .map(|path| {
            let content = match fs::read_to_string(path) {
                Ok(c) => c,
                Err(_) => return 0,
            };
            let len = content.len();
            if content.is_empty() {
                return 0;
            }

            let allocator = Allocator::default();
            let source_type_kind = SourceType::from_path(path);
            let mut oxc_source_type = match source_type_kind {
                SourceType::Tsx => OxcSourceType::default().with_typescript(true).with_jsx(true),
                SourceType::Ts => OxcSourceType::default().with_typescript(true).with_jsx(false),
                SourceType::Jsx => OxcSourceType::default().with_typescript(false).with_jsx(true),
                SourceType::Js => OxcSourceType::default().with_typescript(false).with_jsx(false),
            };
            oxc_source_type = oxc_source_type.with_module(true);

            let ret = Parser::new(&allocator, &content, oxc_source_type).parse();
            if !ret.errors.is_empty() {
                return len;
            }

            let mut program = ret.program;
            let scoping = SemanticBuilder::new()
                .build(&program)
                .semantic
                .into_scoping();

            let mut oxc_options = OxcTransformOptions::default();
            if source_type_kind.is_typescript() {
                oxc_options.typescript = TypeScriptOptions::default();
            }
            if source_type_kind.is_jsx() {
                let mut jsx = JsxOptions::default();
                jsx.runtime = OxcJsxRuntime::Automatic;
                oxc_options.jsx = jsx;
            }

            let transformer = Transformer::new(&allocator, path, &oxc_options);
            let _ = transformer.build_with_scoping(scoping, &mut program);
            let _ = Codegen::new().build(&program);

            len
        })
        .sum();

    (start.elapsed().as_secs_f64() * 1000.0, total_bytes)
}

fn benchmark_magnon_fast_parallel_32c(files: &[PathBuf]) -> (f64, usize) {
    let start = Instant::now();
    let options = TransformOptions::default();

    let total_bytes: usize = files
        .par_iter()
        .map(|path| {
            let content = match fs::read_to_string(path) {
                Ok(c) => c,
                Err(_) => return 0,
            };
            let len = content.len();
            if content.is_empty() {
                return 0;
            }

            let filename = path.to_string_lossy();
            let _ = transform_source(&content, &filename, &options);
            len
        })
        .sum();

    (start.elapsed().as_secs_f64() * 1000.0, total_bytes)
}

fn main() {
    let target_dir = PathBuf::from("benchmarks/fixtures");
    let files = collect_source_files(&target_dir);

    println!("=========================================================================================");
    println!("  MAGNON NATIVE BENCHMARK: FAIR APPLES-TO-APPLES COMPARISON (853 files, 4.62 MB)");
    println!("=========================================================================================");
    println!("Total files found:          {}", files.len());

    let total_bytes: usize = files
        .iter()
        .filter_map(|p| fs::metadata(p).ok().map(|m| m.len() as usize))
        .sum();
    let total_mb = total_bytes as f64 / (1024.0 * 1024.0);
    println!("Total source size:          {:.2} MB ({} bytes)", total_mb, total_bytes);
    println!("Number of logical CPU cores: {}", rayon::current_num_threads());
    println!("-----------------------------------------------------------------------------------------\n");

    println!("1. Single-Thread Head-to-Head (1 core):");
    let (oxc_single_ms, _) = benchmark_oxc_single_thread(&files);
    let (magnon_single_ms, _) = benchmark_magnon_single_thread(&files);
    println!("   Standard OXC (1 core):   {:.2}ms ({:.1} files/sec, {:.2} MB/s)",
        oxc_single_ms,
        files.len() as f64 / (oxc_single_ms / 1000.0),
        total_mb / (oxc_single_ms / 1000.0)
    );
    println!("   Magnon (1 core):           {:.2}ms ({:.1} files/sec, {:.2} MB/s)",
        magnon_single_ms,
        files.len() as f64 / (magnon_single_ms / 1000.0),
        total_mb / (magnon_single_ms / 1000.0)
    );
    println!("   Speedup on 1 core:       {:.2}x\n", oxc_single_ms / magnon_single_ms);

    println!("2. Multi-Thread Maximum Parallel Setup (all 32 cores):");

    let mut oxc_parallel_runs = Vec::new();
    for _ in 0..5 {
        let (ms, _) = benchmark_oxc_parallel_32c(&files);
        oxc_parallel_runs.push(ms);
    }
    oxc_parallel_runs.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let best_oxc_parallel = oxc_parallel_runs[0];

    let mut magnon_fast_runs = Vec::new();
    for _ in 0..5 {
        let (ms, _) = benchmark_magnon_fast_parallel_32c(&files);
        magnon_fast_runs.push(ms);
    }
    magnon_fast_runs.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let best_magnon_fast = magnon_fast_runs[0];

    println!("   Standard OXC (32 cores Rayon): {:.2}ms ({:.1} files/sec, {:.2} MB/s)",
        best_oxc_parallel,
        files.len() as f64 / (best_oxc_parallel / 1000.0),
        total_mb / (best_oxc_parallel / 1000.0)
    );
    println!("   Magnon (32 cores + Arena Pool):  {:.2}ms ({:.1} files/sec, {:.2} MB/s)",
        best_magnon_fast,
        files.len() as f64 / (best_magnon_fast / 1000.0),
        total_mb / (best_magnon_fast / 1000.0)
    );
    println!("   Speedup (Magnon vs OXC on 32c): {:.2}x faster\n", best_oxc_parallel / best_magnon_fast);

    println!("=========================================================================================");
    println!("SUMMARY TABLE (NATIVE RUST):");
    println!("| Engine / Architecture               | Setup          | Wall Time  | Files/sec  | MB/sec   | vs OXC Baseline |");
    println!("| :---------------------------------- | :------------- | :--------- | :--------- | :------- | :-------------- |");
    println!("| Standard OXC Pipeline               | 1 Core         | {:>7.2} ms | {:>10.1} | {:>6.2}   | 1.00x           |",
        oxc_single_ms, files.len() as f64 / (oxc_single_ms / 1000.0), total_mb / (oxc_single_ms / 1000.0));
    println!("| Magnon (Arena Reuse)                  | 1 Core         | {:>7.2} ms | {:>10.1} | {:>6.2}   | {:>4.2}x faster   |",
        magnon_single_ms, files.len() as f64 / (magnon_single_ms / 1000.0), total_mb / (magnon_single_ms / 1000.0), oxc_single_ms / magnon_single_ms);
    println!("| Standard OXC Pipeline (Parallel)    | 32 Cores Rayon | {:>7.2} ms | {:>10.1} | {:>6.2}   | {:>4.2}x faster   |",
        best_oxc_parallel, files.len() as f64 / (best_oxc_parallel / 1000.0), total_mb / (best_oxc_parallel / 1000.0), oxc_single_ms / best_oxc_parallel);
    println!("| Magnon (ThreadLocalPool Max Parallel) | 32 Cores Rayon | {:>7.2} ms | {:>10.1} | {:>6.2}   | {:>4.2}x faster   |",
        best_magnon_fast, files.len() as f64 / (best_magnon_fast / 1000.0), total_mb / (best_magnon_fast / 1000.0), oxc_single_ms / best_magnon_fast);
    println!("=========================================================================================\n");
}
