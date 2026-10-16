#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { transformBatch, compressDirectory } = require('../index.js');

const args = process.argv.slice(2);
const command = args[0];

if (!command || command === '--help' || command === '-h') {
  console.log(`
Magnon - Ultra-High Performance TypeScript & JSX Toolchain in Rust

Usage:
  magnon transform <files...>      Transform TypeScript/JSX files in parallel
  magnon compress <dir> [options]  Compress directory assets in parallel with Brotli & Gzip
  magnon bench [dir]               Run benchmark against target directory
  magnon --help                    Show this message

Compress Options:
  --no-brotli                      Disable Brotli compression
  --no-gzip                        Disable Gzip compression
  --brotli-quality <0-11>          Brotli compression quality (default: 5)
  --gzip-level <1-12>              Gzip compression level (default: 6)
  --threshold <bytes>              Minimum file size threshold (default: 1024)
`);
  process.exit(0);
}

if (command === 'transform') {
  const files = args.slice(1);
  if (files.length === 0) {
    console.error('Error: No files specified.');
    process.exit(1);
  }
  const start = performance.now();
  const res = transformBatch(files);
  const elapsed = performance.now() - start;
  console.log(`Transformed ${res.successfulFiles}/${res.totalFiles} files in ${elapsed.toFixed(2)}ms (${(res.totalBytes / (1024*1024)).toFixed(2)} MB)`);
} else if (command === 'compress') {
  const targetDir = args[1];
  if (!targetDir) {
    console.error('Error: No target directory specified.');
    process.exit(1);
  }

  const noBrotli = args.includes('--no-brotli');
  const noGzip = args.includes('--no-gzip');

  const getArgVal = (name, fallback) => {
    const idx = args.indexOf(name);
    return idx !== -1 && args[idx + 1] ? Number(args[idx + 1]) : fallback;
  };

  const brotliQuality = getArgVal('--brotli-quality', 5);
  const gzipLevel = getArgVal('--gzip-level', 6);
  const threshold = getArgVal('--threshold', 1024);

  const res = compressDirectory(targetDir, {
    brotli: !noBrotli,
    gzip: !noGzip,
    brotliQuality,
    gzipLevel,
    threshold,
    verbose: false,
  });

  const origMb = (res.totalOriginalBytes / (1024 * 1024)).toFixed(2);
  const gzMb = (res.totalGzipBytes / (1024 * 1024)).toFixed(2);
  const brMb = (res.totalBrotliBytes / (1024 * 1024)).toFixed(2);

  console.log(`Compressed ${res.totalFiles} assets in ${res.durationMs.toFixed(1)}ms (${origMb} MB -> gz: ${gzMb} MB, br: ${brMb} MB)`);
} else if (command === 'bench') {
  const targetDir = args[1] || 'src';
  console.log(`Benchmarking directory: ${targetDir}`);
  const collect = (dir) => {
    let out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!entry.name.startsWith('.') && entry.name !== 'node_modules') {
          out.push(...collect(full));
        }
      } else if (/\.[jt]sx?$/.test(entry.name)) {
        out.push(full);
      }
    }
    return out;
  };
  const files = collect(targetDir);
  console.log(`Found ${files.length} source modules.`);
  if (files.length > 0) {
    const start = performance.now();
    const res = transformBatch(files);
    const elapsed = performance.now() - start;
    console.log(`Magnon Transform Wall Time: ${elapsed.toFixed(2)}ms`);
    console.log(`Throughput: ${(files.length / (elapsed / 1000)).toFixed(1)} files/sec`);
  }
} else {
  console.error(`Unknown command: ${command}`);
  process.exit(1);
}
