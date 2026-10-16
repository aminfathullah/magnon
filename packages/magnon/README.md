# magnon

Magnon: Ultra-high performance TypeScript and JSX compiler, barrel file import optimizer, parallel asset compressor, and Vite plugin written in pure Rust.

## Features

- **Highest Throughput Web Compiler**: Processes over 113,000 files/sec (613 MB/s) on multi-core systems.
- **Drop-in Vite Plugin**: Zero-configuration replacement for `@vitejs/plugin-react` and `@vitejs/plugin-react-swc`.
- **Native Barrel File Import Optimization**: AST-level rewriting of barrel imports (`@tabler/icons-react`, `@mui/material`, `@mui/icons-material`, `lodash`, etc.) into direct file imports, cutting Rollup AST memory bloat by over 16,000 modules.
- **Native Multi-Threaded Asset Compression**: Parallel Brotli and Gzip bundle compression in pure Rust using Rayon (up to 195x faster than Node-based compression plugins).
- **Fast Chunk Splitting Utility**: High-performance vendor chunk splitter replacing slow regex loops in Rollup `manualChunks`.
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

### Vite Plugin (Compilation + Import Optimization + Compression)

In your `vite.config.js` or `vite.config.mjs`:

```javascript
import { defineConfig } from 'vite';
import magnon, { compression, splitChunks } from 'magnon/vite';

export default defineConfig({
  plugins: [
    // Fast JSX/TSX compilation with automatic barrel import optimization
    magnon({
      jsxRuntime: 'automatic',
      development: process.env.NODE_ENV !== 'production',
      // Enabled by default for @tabler/icons-react, @mui/material, @mui/icons-material, lodash, date-fns
      optimizePackageImports: [
        '@tabler/icons-react',
        '@mui/material',
        '@mui/icons-material',
        '@mui/lab',
        'lodash',
      ],
      // Or define custom template rewrite rules
      modularizeImports: {
        'my-design-system': {
          transform: 'my-design-system/es/{{member}}',
        },
      },
    }),
    // Standalone drop-in replacement for vite-plugin-compression
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
        // Fast vendor chunk splitting without slow regex loops
        manualChunks: splitChunks({
          'igniteui-vendor': ['igniteui-react'],
          'swagger-vendor': ['swagger-ui', 'swagger-client'],
          'ag-grid-vendor': ['ag-grid'],
          'excel-vendor': ['exceljs'],
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
// Output: import IconUsers from "@tabler/icons-react/dist/esm/icons/IconUsers.mjs";
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
# Transform source files
npx magnon transform src/**/*.tsx

# Compress build assets in parallel
npx magnon compress dist --brotli --gzip

# Run internal benchmark suite
npx magnon bench
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

### 2. Full Bundle Compression (198 Files, 45.0 MB JavaScript & CSS)

Evaluated against a real-world enterprise production bundle (Majapahit):

| Compression Engine | Algorithm | Cores | Time (ms) | Speedup vs Node.js |
| :--- | :--- | :---: | :---: | :---: |
| **Magnon Native (Rayon)** | **Brotli + Gzip Dual** | **32c** | **385 ms** | **~195x faster** |
| **Node.js `vite-plugin-compression`** | Brotli + Gzip Dual | Node pool | ~75,000 ms | Baseline |

### 3. Barrel File Import Elimination

Tested on Majapahit enterprise frontend (Vite 6, React 18, 382 MUI imports, 156 Tabler Icon imports):

| Metric | Before Magnon Optimization | With Magnon `optimizePackageImports` | Reduction |
| :--- | :---: | :---: | :---: |
| **Rollup Modules Parsed** | 33,427 modules | 17,040 modules | **-16,387 modules (-49%)** |
| **V8 Heap Memory Pressure** | >4,000 MB (83% time in GC) | <1,800 MB | **-55% memory pressure** |
| **Build Time** | 1m 42s (102s) | 1m 22s (82s) | **-20s faster (-20%)** |

## License

MIT
