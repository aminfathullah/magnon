# magnon

Magnon is a high-throughput Rust compiler, AST-level import optimizer, parallel asset compressor, multi-threaded obfuscator, and universal CJS/ESM interop plugin for Vite and Rolldown.

## Features

- **Highest Throughput Web Compiler**: Processes over 118,000 files/sec (640+ MB/s) in Node.js and over 270,000 files/sec (1,460+ MB/s) in native Rust via Rayon parallel iterators and reusable thread-local bump arenas.
- **Drop-in Vite & Rolldown Plugin**: Zero-configuration replacement for `@vitejs/plugin-react` and `@vitejs/plugin-react-swc`.
- **Universal CJS/ESM Interop Normalization (Zero-Config)**: Automatically intercepts chunks in the `renderChunk` pipeline before chunk hashing to normalize CommonJS-to-ESM default export bindings. Prevents React Error #130 (`Element type is invalid: expected a string or class/function but got: object`) for CommonJS modules (such as `react-slick`, legacy charting, and date pickers) in Vite 8 / Rolldown builds without modifying application source code or requiring custom aliases.
- **Deterministic Content-Addressable Hashing**: Interop patches are applied prior to hash generation, ensuring emitted chunk hashes strictly reflect the final executable code and eliminating stale immutable CDN cache collisions on platforms like Cloudflare Pages, Vercel, and Netlify.
- **AST Barrel File Import Optimization**: Transforms barrel imports (`@tabler/icons-react`, `@mui/material`, `@mui/icons-material`, `lucide-react`, `lodash`, etc.) into direct subpath imports at the AST level, cutting Rollup/Rolldown module graph overhead by over 16,000 modules.
- **Dynamic General-Purpose Package Resolution**: Any library specified in `optimizePackageImports` automatically resolves direct named-to-default imports (`{{source}}/{{member}}`) without hardcoded restrictions.
- **Dual Engine Code Splitting**: High-performance chunk partitioner providing instant compatibility for both Rolldown `codeSplitting.groups` and Rollup `manualChunks`.
- **Parallel Chunk Obfuscation**: Multi-threaded JavaScript obfuscator running across worker thread pools with customizable anti-debugging traps and automatic `node_modules` vendor exclusion.
- **Native Multi-Threaded Asset Compression**: Parallel Brotli and Gzip bundle compression in pure Rust using Rayon (up to 45x-195x faster than Node-based compression plugins).
- **Zero Allocator Contention**: Thread-local bump allocation eliminates per-module allocator mutex contention and garbage collection pauses.
- **Single FFI Boundary Crossing**: `transformBatch` and `compressDirectory` process entire directories in native Rust in a single Node-API call.

## Installation

```bash
npm install magnon
# or
pnpm add magnon
# or
yarn add magnon
```

## Quickstart

### Vite Configuration

In `vite.config.js` or `vite.config.mjs`:

```javascript
import { defineConfig } from 'vite';
import magnon, { compression, splitChunks, obfuscator } from 'magnon/vite';

export default defineConfig({
  plugins: [
    magnon({
      jsxRuntime: 'automatic',
      development: process.env.NODE_ENV !== 'production',
      optimizePackageImports: [
        '@tabler/icons-react',
        '@mui/material',
        '@mui/icons-material',
        'lucide-react',
        '@acme/components',
      ],
      modularizeImports: {
        'my-design-system': {
          transform: 'my-design-system/es/{{member}}',
        },
      },
    }),
    obfuscator({
      enable: process.env.NODE_ENV === 'production',
      debugProtection: true,
      debugProtectionInterval: 2000,
      autoExcludeNodeModules: true,
    }),
    compression({
      brotli: true,
      gzip: true,
      brotliQuality: 5,
      gzipLevel: 6,
      threshold: 1024,
    }),
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks: splitChunks({
          framework: 'react',
          chunks: {
            'ui-vendor': ['@mui/material', '@tabler/icons-react'],
            'utils-vendor': ['lodash', 'date-fns', 'ramda'],
          },
        }),
      },
    },
  },
});
```

### Programmatic API

#### Single File Transform with Import Modularization

```javascript
const { transform } = require('magnon');

const result = transform(
  "import { IconUsers } from '@tabler/icons-react';",
  'index.tsx',
  {
    optimizePackageImports: ['@tabler/icons-react'],
  }
);
console.log(result.code);
```

#### Parallel Multi-Core Asset Compression

```javascript
const { compressDirectory, compressBrotli, compressGzip } = require('magnon');

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
npx magnon compress dist --brotli --gzip
npx magnon bench
```

## Benchmarks

### 1. Multi-Core Compiler Throughput (Node.js Environment)

Evaluated against an 853-file production corpus (Three.js modules + React components, 4.62 MB, 32 CPU cores):

| Compiler / Toolchain | Cores | Wall Time | Throughput | Bandwidth | Speedup vs Baseline |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Magnon (Parallel Batch Engine)** | **32c** | **7.17 ms** | **118,921.2 files/s** | **644.76 MB/s** | **14.34x vs SWC** (3.89x vs Rspack) |
| **Rspack (`experiments.swc.transform`)** | 32c | 27.91 ms | 30,529.2 files/s | 165.72 MB/s | 3.69x vs SWC |
| **SWC (`swc.transform` Promise.all)** | 32c | 102.86 ms | 8,283.2 files/s | 44.96 MB/s | 1.00x (Baseline) |
| **esbuild (`esbuild.transform` Promise.all)** | 32c | 177.25 ms | 4,806.8 files/s | 26.09 MB/s | 0.58x vs SWC |

### 2. Native Rust Compiler Performance (Zero FFI Overhead)

Evaluated natively in Rust against standard OXC pipeline on 853 files (4.62 MB):

| Engine / Architecture | Cores | Wall Time | Throughput | Bandwidth | Speedup |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Magnon (ThreadLocalPool + Bump Arena)** | **32c** | **3.15 ms** | **270,610.1 files/s** | **1,467.19 MB/s** | **20.02x faster** |
| **Standard OXC Pipeline (Parallel)** | 32c | 3.56 ms | 239,657.0 files/s | 1,299.37 MB/s | 17.73x faster |
| **Magnon (Single Core Arena)** | 1c | 58.54 ms | 14,570.3 files/s | 79.00 MB/s | 1.08x faster |
| **Standard OXC Pipeline (Single Core)** | 1c | 63.10 ms | 13,518.7 files/s | 73.30 MB/s | 1.00x (Baseline) |

### 3. Rolldown / Rollup CJS Interop Normalization & CDN Cache Integrity

Evaluated on a 200-chunk production bundle (20 MB minified JavaScript):

| Interop Strategy | Hook Phase | 200-Chunk Cost | Latency / Chunk | CDN Cache Determinism | Safe for CDNs |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Magnon Pre-Hash Normalizer** | **`renderChunk`** | **0.29 ms** | **1.45 µs** | **Content-Hashed** | **YES (Immutable safe)** |
| **Post-Build Disk Scan & Rename** | `closeBundle` | 53.42 ms | 267.09 µs | Hash Desync / Conflict | NO (Stale CDN hits) |

### 4. Parallel Asset Compression (Dual Brotli + Gzip)

| Compression Engine | Algorithm | Cores | Wall Time | Throughput | Speedup vs Node.js |
| :--- | :--- | :---: | :---: | :---: | :---: |
| **Magnon Native (Rayon)** | **Brotli + Gzip Dual** | **32c** | **0.28 ms** | **362,250.6 files/s** | **45.27x faster** |
| **Node.js zlib (`Promise.all`)** | Brotli + Gzip Dual | Node pool | 12.50 ms | 8,001.3 files/s | 1.00x (Baseline) |

### 5. Enterprise Production Build Benchmark

Tested on a production enterprise React application (222 assets, 20 MB bundle, full tree-shaking, vendor chunking, critical obfuscation, dual Brotli/Gzip compression):

| Metric | Vite 6 + Rollup (Baseline) | Vite 8 + Rolldown (Unoptimized) | Vite 8 + Rolldown + Magnon 0.1.17 |
| :--- | :---: | :---: | :---: |
| **Build Wall Time** | 102.0s (1m 42s) | 17.7s | **4.15s (-96% vs baseline)** |
| **Rollup Modules Parsed** | 33,427 modules | 33,427 modules | **17,040 modules (-49%)** |
| **V8 Heap Memory Pressure** | >4,000 MB (GC bound) | ~3,200 MB | **<1,800 MB (-55%)** |
| **CJS Runtime Safety** | Prone to Error #130 | Prone to Error #130 | **100% Robust (Zero Error #130)** |
| **CDN Cache Coherence** | Standard | Stale hash collisions | **Deterministic pre-hash output** |

## License

MIT
