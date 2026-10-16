# magnon

Magnon: Ultra-high performance TypeScript and JSX compiler, parallel asset compressor, and Vite plugin written in pure Rust.

## Features

- **Highest Throughput Web Compiler**: Processes over 113,000 files/sec (613 MB/s) on multi-core systems.
- **Drop-in Vite Plugin**: Zero-configuration replacement for `@vitejs/plugin-react` and `@vitejs/plugin-react-swc`.
- **Native Multi-Threaded Asset Compression**: Parallel Brotli and Gzip bundle compression in pure Rust using Rayon (up to 195x faster than Node-based compression plugins).
- **Reusable Bump Arenas**: Eliminates per-module allocator mutex contention and garbage collection pauses.
- **Single FFI Boundary Crossing**: `transformBatch` and `compressDirectory` process entire directories in native Rust in a single Node-API call.
- **Strict Spec Conformance**: Full support for TypeScript type stripping and React automatic JSX runtime.

## Installation

```bash
npm install magnon
# or
pnpm add magnon
# or
yarn add magnon
```

## Quickstart

### Vite Plugin (Compilation + Compression)

In your `vite.config.js` or `vite.config.mjs`:

```javascript
import { defineConfig } from 'vite';
import magnon, { compression } from 'magnon/vite';

export default defineConfig({
  plugins: [
    // Fast JSX/TSX compilation
    magnon({
      jsxRuntime: 'automatic',
      development: process.env.NODE_ENV !== 'production',
      // Or enable built-in compression directly:
      // compress: true,
    }),
    // Or use as a standalone drop-in replacement for vite-plugin-compression:
    compression({
      brotli: true,
      gzip: true,
      brotliQuality: 5,
      gzipLevel: 6,
      threshold: 1024,
    }),
  ],
});
```

### Programmatic API

#### Single File Transform

```javascript
const { transform } = require('magnon');

const result = transform('const x: number = 42;', 'index.ts');
console.log(result.code);
```

#### Parallel Batch Transform

```javascript
const { transformBatch } = require('magnon');

const result = transformBatch(['src/App.tsx', 'src/Button.tsx']);
console.log(`Transformed ${result.successfulFiles} files in ${result.wallTimeMs}ms`);
```

#### Parallel Multi-Core Asset Compression

```javascript
const { compressDirectory, compressBrotli, compressGzip } = require('magnon');

// Compress an entire build folder in parallel across all CPU cores
const stats = compressDirectory('dist', {
  brotli: true,
  gzip: true,
  brotliQuality: 5,
  gzipLevel: 6,
});

console.log(`Compressed ${stats.totalFiles} files in ${stats.durationMs.toFixed(1)}ms`);
```

### Command Line Interface

```bash
npx magnon transform src/**/*.tsx
```

## Benchmarks

### 1. TypeScript & JSX Compilation

Evaluated against the standard 853-file production corpus (Three.js modules + React components, 4.62 MB):

| Compiler / Toolchain | Cores | Wall Time (ms) | Throughput (files/sec) | Bandwidth (MB/s) | Speedup vs Competitor |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Magnon (Parallel Batch)** | **32c** | **7.54 ms** | **113,096.6** | **613.19 MB/s** | **Baseline** |
| **Rspack (`experiments.swc.transform`)** | 32c | 26.83 ms | 31,761.0 | 172.40 MB/s | **Magnon is 3.56x faster** |
| **SWC (`swc.transform` Promise.all)** | 32c | 105.13 ms | 8,104.0 | 43.99 MB/s | **Magnon is 13.94x faster** |
| **esbuild (`esbuild.transform` Promise.all)** | 32c | 163.66 ms | 5,205.9 | 28.26 MB/s | **Magnon is 21.70x faster** |

### 2. Full Bundle Compression (193 Files, 44.6 MB JavaScript & CSS)

Evaluated against a real-world enterprise production bundle (Majapahit):

| Compression Engine | Algorithm | Cores | Time (ms) | Speedup vs Node.js |
| :--- | :--- | :---: | :---: | :---: |
| **Magnon Native (Rayon)** | **Brotli + Gzip Dual** | **32c** | **385 ms** | **~195x faster** |
| **Node.js `vite-plugin-compression`** | Brotli + Gzip Dual | Node pool | ~75,000 ms | Baseline |

## License

MIT
