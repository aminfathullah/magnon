#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { transformBatch } = require('../index.js');

const args = process.argv.slice(2);
const command = args[0];

if (!command || command === '--help' || command === '-h') {
  console.log(`
Magnon - Rust-Powered TypeScript & JSX Toolchain

Usage:
  magnon transform <files...>   Transform files in parallel
  magnon bench [dir]           Run benchmark against target directory
  magnon --help                Show this message
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
  console.log(`Found ${files.length} files.`);
  const start = performance.now();
  const res = transformBatch(files);
  const elapsed = performance.now() - start;
  console.log(`Magnon Wall Time: ${elapsed.toFixed(2)}ms`);
  console.log(`Throughput: ${(files.length / (elapsed / 1000)).toFixed(1)} files/sec`);
} else {
  console.error(`Unknown command: ${command}`);
  process.exit(1);
}
