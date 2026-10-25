# magnon

Vite and Rolldown plugin powered by a native Rust engine (OXC, `libdeflater`, `brotli`, `rayon`). Combines TypeScript/JSX compilation, AST-level barrel import optimization, Rolldown CommonJS/ESM default export normalization, CSS Modules ICSS `:export` bridging, dual-engine chunk splitting, and parallel Brotli/Gzip asset compression.

## Features

- **TypeScript and JSX Transform**: Fast transform via OXC with reusable thread-local memory arenas (`ThreadLocalPool`).
- **AST Barrel Import Rewriting**: Rewrites named imports (`@tabler/icons-react`, `@mui/material`, `lucide-react`, `lodash`, etc.) into direct file paths during AST parsing, bypassing barrel index files.
- **Rolldown CJS/ESM Interop Normalization**: Patches CommonJS default export namespace bindings in `renderChunk` before chunk hashing, eliminating React Error #130 without invalidating CDN content hashes.
- **CSS Modules ICSS `:export` Support**: Parses `:export` blocks in `.module.scss` and `.module.css` with transitive SCSS variable resolution for LightningCSS and Rolldown builds.
- **Dual-Engine Chunk Splitting**: Unified syntax supporting both Rolldown `codeSplitting.groups` and Rollup `manualChunks`.
- **Parallel Compression**: Multi-threaded Brotli and Gzip (`libdeflater`) compression directly in Rust via Rayon.
- **Parallel Obfuscation**: Worker-thread pool running `javascript-obfuscator` with vendor chunk exclusion and anti-debugger traps.
- **Rolldown HookFilter Support**: Uses Rolldown object hook filters on `transform`, `resolveId`, `load`, and `renderChunk` to skip non-matching files on the Rust side.

## Installation

```bash
npm install -D magnon
# or
pnpm add -D magnon
# or
yarn add -D magnon
```

Requires Node.js >= 18. Precompiled binaries are provided for Linux x64, macOS x64/arm64, and Windows x64.

Optional dependencies:
- `javascript-obfuscator`: Required if enabling `obfuscator()`.
- `sass`: Required if using SCSS variables in `:export` blocks.

## Usage

### Drop-in Replacement for `@vitejs/plugin-react`

In `vite.config.ts`:

```ts
import { defineConfig } from 'vite';
import magnon from 'magnon';

export default defineConfig({
  plugins: [magnon()],
});
```

### Full Configuration Example

```ts
import { defineConfig } from 'vite';
import magnon, { compression, splitChunks, obfuscator } from 'magnon/vite';

export default defineConfig({
  plugins: [
    magnon({
      jsxRuntime: 'automatic',
      optimizePackageImports: [
        '@tabler/icons-react',
        '@mui/material',
        '@mui/icons-material',
        'lucide-react',
      ],
      modularizeImports: {
        'design-system': {
          transform: 'design-system/es/{{member}}',
        },
      },
    }),
    compression({
      brotli: true,
      gzip: true,
      threshold: 1024,
    }),
    obfuscator({
      enable: process.env.NODE_ENV === 'production',
      debugProtection: true,
      autoExcludeNodeModules: true,
    }),
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks: splitChunks({
          framework: 'react',
          chunks: {
            'ui-vendor': ['@mui/material', '@tabler/icons-react'],
            'utils-vendor': ['lodash', 'date-fns'],
          },
        }),
      },
    },
  },
});
```

## Capabilities

### Barrel Import Optimization

Transforms named barrel imports into direct file imports during AST parsing to prevent the bundler from traversing thousands of re-exports:

```ts
// Input
import { IconUsers } from '@tabler/icons-react';
import { Button } from '@mui/material';

// Output
import IconUsers from '@tabler/icons-react/dist/esm/icons/IconUsers.mjs';
import Button from '@mui/material/Button';
```

#### Built-in Presets

| Package | Rewritten Target Path | Notes |
| :--- | :--- | :--- |
| `@tabler/icons-react` | `@tabler/icons-react/dist/esm/icons/{{member}}.mjs` | Default import |
| `@mui/icons-material` | `@mui/icons-material/esm/{{member}}` | Default import |
| `@mui/material` | `@mui/material/{{member}}` | PascalCase only; excludes context and type helpers |
| `@mui/lab` | `@mui/lab/{{member}}` | PascalCase only |
| `lucide-react` | `lucide-react/dist/esm/icons/{{kebabCase member}}` | Kebab-case filenames |
| `@heroicons/react/24/outline` | `@heroicons/react/24/outline/{{member}}` | Default import |
| `@heroicons/react/24/solid` | `@heroicons/react/24/solid/{{member}}` | Default import |
| `@heroicons/react/20/solid` | `@heroicons/react/20/solid/{{member}}` | Default import |
| `@phosphor-icons/react` | `@phosphor-icons/react/dist/csr/{{member}}` | CSR target |
| `lodash` | `lodash/{{member}}` | Direct import |
| `lodash-es` | `lodash-es/{{member}}` | Direct import |
| `date-fns` | `date-fns/{{member}}` | Direct import |
| `ramda` | `ramda/es/{{member}}` | Direct import |
| `react-bootstrap` | `react-bootstrap/{{member}}` | PascalCase only |
| `antd` | `antd/es/{{member}}` | Direct import |
| `rxjs` | `rxjs/{{member}}` | Direct import |
| `rxjs/operators` | `rxjs/operators/{{member}}` | Direct import |

Packages not in the preset list default to resolving `{{source}}/{{member}}`.

#### Custom Rewrite Rules (`modularizeImports`)

```ts
magnon({
  modularizeImports: {
    'my-library': {
      transform: 'my-library/dist/components/{{kebabCase member}}',
      skipDefaultConversion: false,
      pascalCaseOnly: true,
      include: ['Button', 'Dialog'],
      exclude: ['ButtonProps'],
    },
  },
})
```

Supported template tokens: `{{member}}`, `{{kebabCase member}}`, `{{camelCase member}}`, `{{snakeCase member}}`, `{{lowerCase member}}`, `{{upperCase member}}`.

### Rolldown CommonJS / ESM Default Interop

Rolldown's strict ESM default-import handling for CommonJS dependencies (such as `react-slick` or legacy chart libraries) can result in `{ default: Component, __esModule: true }`, triggering React Error #130 (`Element type is invalid: expected a string or class/function but got: object`).

Magnon intercepts chunks during `renderChunk` and patches the interop check:

```js
// Rolldown runtime check:
!n || !n.__esModule || !a.call(n, "default") ? t(o, "default", { value: n, enumerable: true }) : o

// Patched by Magnon:
(!n || !a.call(n, "default")) ? t(o, "default", { value: n, enumerable: true }) : o
```

Applying this patch in `renderChunk` ensures Rolldown calculates chunk hashes *after* the modification, preserving deterministic content hashes for immutable CDN caches.

### CSS Modules ICSS `:export`

LightningCSS and Rolldown do not parse ICSS `:export` blocks used by design systems in `.module.scss` or `.module.css`. Magnon resolves these files with a virtual ID (`\0magnon-icss:`), evaluates SCSS variables, and generates JavaScript exports alongside clean CSS imports:

```scss
/* Input styles.module.scss */
$primary: #1976d2;
:export {
  primaryColor: $primary;
}
```

```ts
// Consuming component
import styles, { primaryColor } from './styles.module.scss';
console.log(primaryColor); // "#1976d2"
```

### Dual-Engine Code Splitting

`splitChunks()` and `codeSplitting()` generate chunk rules that work with both Rolldown `output.codeSplitting.groups` and Rollup `output.manualChunks`:

```ts
import { splitChunks } from 'magnon/vite';

const chunks = splitChunks({
  framework: 'react', // Built-in preset
  chunks: {
    'vendor-charts': ['chart.js', 'recharts'],
    'vendor-utils': ['lodash', 'date-fns'],
  },
});

export default defineConfig({
  build: {
    rolldownOptions: {
      output: { codeSplitting: { groups: chunks.groups } },
    },
    rollupOptions: {
      output: { manualChunks: chunks },
    },
  },
});
```

Built-in framework presets: `react`, `vue`, `svelte`, `preact`, `solid`.

### Parallel Asset Compression

Compresses build output in parallel using pure Rust implementations of Brotli and Gzip (`libdeflater`) via Rayon:

```ts
import { compression } from 'magnon/vite';

export default defineConfig({
  plugins: [
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

Programmatic usage:

```js
const { compressDirectory } = require('magnon');

const res = compressDirectory('dist', {
  brotli: true,
  gzip: true,
  threshold: 1024,
});
console.log(`Compressed ${res.totalFiles} assets in ${res.durationMs.toFixed(1)}ms`);
```

### Parallel Obfuscation

Distributes chunk obfuscation across Node.js worker threads using `javascript-obfuscator`, automatically excluding `node_modules` chunks:

```ts
import { obfuscator } from 'magnon/vite';

export default defineConfig({
  plugins: [
    obfuscator({
      enable: process.env.NODE_ENV === 'production',
      threads: 4,
      autoExcludeNodeModules: true,
      debugProtection: true,
      debugProtectionInterval: 2000,
      criticalModuleFragments: ['auth', 'crypto'],
    }),
  ],
});
```

*Note: Requires `javascript-obfuscator` installed as a devDependency.*

## Configuration Reference

### `magnon(options)`

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `jsxRuntime` | `'automatic' \| 'classic'` | `'automatic'` | JSX runtime transformation mode. |
| `development` | `boolean` | `false` | Enables development-specific helpers in JSX output. |
| `sourcemap` | `boolean` | `false` | Generates source maps for transformed modules. |
| `optimizePackageImports` | `string[] \| boolean` | `DEFAULT_OPTIMIZE_IMPORTS` | Package names whose barrel imports should be rewritten to direct subpaths. |
| `modularizeImports` | `Record<string, PackageImportRule>` | `{}` | Custom template-based subpath import rewriting rules. |
| `esmAliases` | `string[]` | `[]` | Package names to automatically alias to `/esm` subpaths. |
| `alias` | `Record<string, string> \| Array<{ find, replacement }>` | `undefined` | Custom module alias definitions. |
| `compress` | `boolean \| CompressOptions` | `false` | Enables post-build asset compression directly within the main plugin. |
| `codeSplitting` | `boolean \| CodeSplittingOptions` | `false` | Applies chunk grouping rules to Rolldown and Rollup outputs. |
| `prewarm` | `boolean` | `true` | Pre-transforms application source files in parallel during `configResolved`. |
| `include` | `RegExp \| string[]` | `/\.[jt]sx?$/` | Filter for files to compile. |
| `exclude` | `RegExp \| string[]` | `/node_modules/` | Filter for files to exclude from compilation. |

### `compression(options)`

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `gzip` | `boolean` | `true` | Emits `.gz` files for compressible assets. |
| `brotli` | `boolean` | `true` | Emits `.br` files for compressible assets. |
| `gzipLevel` | `number` | `5` | Gzip compression level (1-12). |
| `brotliQuality` | `number` | `3` | Brotli compression quality (0-11). |
| `threshold` | `number` | `1024` | Minimum file size in bytes before compression is applied. |
| `extensions` | `string[]` | `['js', 'mjs', 'cjs', 'css', 'html', 'svg', 'json', 'wasm', 'txt', 'xml']` | Target file extensions. |
| `deleteOriginal` | `boolean` | `false` | Deletes uncompressed original files after compression. |
| `verbose` | `boolean` | `true` | Logs total compressed count, elapsed time, and sizes to terminal. |

### `splitChunks(options)` / `codeSplitting(options)`

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `framework` | `'react' \| 'vue' \| 'svelte' \| 'preact' \| 'solid' \| false` | `'react'` | Framework vendor chunk preset. |
| `frameworkChunkName` | `string` | `'core-vendor'` | Output chunk name for the framework vendor bundle. |
| `chunks` | `Record<string, string[] \| { test, priority }>` | `{}` | Custom vendor chunk definitions. |
| `groups` | `RolldownGroup[]` | `[]` | Explicit Rolldown code-splitting group definitions. |

### `obfuscator(options)`

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `enable` | `boolean` | `true` | Enables chunk obfuscation. |
| `threads` | `number` | `os.cpus() (max 8)` | Number of worker threads allocated for parallel obfuscation. |
| `autoExcludeNodeModules` | `boolean` | `true` | Excludes vendor chunks and `node_modules` from obfuscation. |
| `obfuscateEntry` | `boolean` | `false` | Obfuscates entry chunk if set to `true`. |
| `debugProtection` | `boolean` | `false` | Injects an anti-debugging debugger evaluation trap. |
| `debugProtectionInterval` | `number \| boolean` | `2000` | Timer interval in milliseconds for debugger checks. |
| `minChunkSize` | `number` | `0` | Minimum chunk byte size threshold for obfuscation. |
| `criticalModuleFragments` | `string[]` | `[]` | Path substrings of modules to pre-warm and obfuscate during transform phase. |
| `options` | `Record<string, any>` | `{}` | Passthrough configuration object passed to `javascript-obfuscator`. |

## Programmatic Node API

```js
const {
  transform,
  transformBatch,
  compressDirectory,
  compressFiles,
  compressGzip,
  compressBrotli,
} = require('magnon');

// Single file transform
const result = transform(
  "import { IconUsers } from '@tabler/icons-react';",
  'index.tsx',
  { optimizePackageImports: ['@tabler/icons-react'] }
);
console.log(result.code);

// Parallel batch transform
const batch = transformBatch(['src/App.tsx', 'src/index.tsx'], {
  jsxRuntime: 'automatic',
});
console.log(`Transformed ${batch.successfulFiles}/${batch.totalFiles} in ${batch.wallTimeMs.toFixed(1)}ms`);

// Direct buffer compression
const gzBuffer = compressGzip(Buffer.from('hello world'), 6);
const brBuffer = compressBrotli(Buffer.from('hello world'), 5);
```

## Command Line Interface

```bash
# Transform TypeScript and JSX files in parallel:
npx magnon transform src/**/*.tsx

# Compress build directory with Brotli and Gzip:
npx magnon compress dist --brotli-quality 5 --gzip-level 6 --threshold 1024

# Run performance benchmark against target directory:
npx magnon bench src
```

### CLI Options

| Command | Option | Default | Description |
| :--- | :--- | :--- | :--- |
| `transform` | `<files...>` | - | Path list of files to compile. |
| `compress` | `<dir>` | - | Target directory to compress in place. |
| `compress` | `--no-brotli` | `false` | Disables Brotli compression. |
| `compress` | `--no-gzip` | `false` | Disables Gzip compression. |
| `compress` | `--brotli-quality <0-11>` | `5` | Brotli compression quality level. |
| `compress` | `--gzip-level <1-12>` | `6` | Gzip compression level. |
| `compress` | `--threshold <bytes>` | `1024` | Minimum file size threshold for compression. |
| `bench` | `[dir]` | `'src'` | Measures transform and compression throughput. |

## Benchmarks

Measurements conducted on an Intel Xeon Gold system (32 physical cores, 64 threads, Linux x86_64, Node.js v20) using an 853-file production corpus (Three.js modules and React/TypeScript components, 4.62 MB total source).

### 1. Multi-Core Compiler Throughput (Node.js Environment)

All compilers configured to transform the 853-file corpus with JSX automatic runtime across 32 cores:

| Compiler / Engine | Cores | Wall Time | Throughput | Bandwidth | Speedup vs SWC |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Magnon (Parallel Batch Engine)** | **32c** | **7.59 ms** | **112,424.6 files/s** | **609.54 MB/s** | **13.43x** (3.57x vs Rspack) |
| **Rspack (`experiments.swc.transform`)** | 32c | 27.07 ms | 31,474.9 files/s | 170.85 MB/s | 3.76x |
| **SWC (`swc.transform` Promise.all)** | 32c | 101.88 ms | 8,363.0 files/s | 45.40 MB/s | 1.00x (Baseline) |
| **esbuild (`esbuild.transform` Promise.all)** | 32c | 179.82 ms | 4,738.2 files/s | 25.72 MB/s | 0.57x |

### 2. Native Rust Compiler Performance (Zero FFI Overhead)

Evaluated natively in Rust comparing Magnon's thread-local bump allocator against the standard OXC pipeline on the 853-file corpus:

| Engine / Architecture | Cores | Wall Time | Throughput | Bandwidth | Speedup |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Magnon (ThreadLocalPool + Bump Arena)** | **32c** | **2.95 ms** | **288,674.2 files/s** | **1,565.13 MB/s** | **1.18x vs OXC** |
| **Standard OXC Pipeline (Parallel)** | 32c | 3.48 ms | 245,374.3 files/s | 1,330.37 MB/s | Baseline (Parallel) |
| **Magnon (Single Core Arena)** | 1c | 58.83 ms | 14,499.3 files/s | 78.61 MB/s | 1.06x vs OXC (Single Core) |
| **Standard OXC Pipeline (Single Core)** | 1c | 62.07 ms | 13,742.0 files/s | 74.51 MB/s | Baseline (Single Core) |

### 3. Rolldown / Rollup CJS Interop Normalization & Cache Integrity

Evaluated on a 200-chunk production bundle (20 MB minified JavaScript):

| Interop Strategy | Hook Phase | 200-Chunk Cost | Latency / Chunk | Hash Determinism | Immutable CDN Safe |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Magnon Pre-Hash Normalizer** | **`renderChunk`** | **0.35 ms** | **1.73 µs** | **Content-Hashed** | **Yes** |
| **Post-Build Disk Scan & Rename** | `closeBundle` | 53.90 ms | 269.50 µs | Hash Desync | No (Stale cache collisions) |

### 4. Parallel Asset Compression (Dual Brotli + Gzip)

Tested on 100 compressible bundle assets:

| Compression Engine | Algorithm | Cores | Wall Time | Throughput | Speedup vs Node.js |
| :--- | :--- | :---: | :---: | :---: | :---: |
| **Magnon Native (Rayon)** | **Brotli + Gzip Dual** | **32c** | **0.26 ms** | **382,871.8 files/s** | **47.50x** |
| **Node.js zlib (`Promise.all`)** | Brotli + Gzip Dual | Node pool | 12.41 ms | 8,060.0 files/s | 1.00x (Baseline) |

### 5. Enterprise Production Build Benchmark

Tested on an enterprise React application (187 assets, 20.21 MB bundle, tree-shaking, vendor chunking, obfuscation, Brotli/Gzip compression):

| Metric | Vite 6 + Rollup (Baseline) | Vite 8 + Rolldown (Unoptimized) | Vite 8 + Rolldown + Magnon |
| :--- | :---: | :---: | :---: |
| **Build Wall Time** | 102.0s | 17.7s | **2.74s - 2.86s (-97.3%)** |
| **JS Transform FFI Calls** | 16,023 calls | 16,023 calls | **519 calls (HookFilter, -96.8%)** |
| **Dual Compression (187 assets)** | ~1,200 ms | ~1,200 ms | **60 - 69 ms** |
| **Obfuscation Latency** | ~2,400 ms | ~2,400 ms | **~185 ms** |
| **Rollup Modules Parsed** | 33,427 modules | 33,427 modules | **16,023 modules (-52%)** |
| **V8 Heap Memory Pressure** | >4,000 MB | ~3,200 MB | **<1,600 MB (-60%)** |
| **CSS Modules (:export ICSS)** | Supported | Fails (Error #12) | **Supported** |
| **CJS Runtime Safety** | Prone to Error #130 | Prone to Error #130 | **Normalized** |
| **CDN Cache Coherence** | Standard | Hash desync | **Deterministic** |

## Technical Architecture

```
[ Application Source Modules ]
              │
              ▼
   [ Vite configResolved ] ──► [ Magnon Parallel Prewarm ] ──► (ThreadLocalPool Bump Allocator)
              │                                                (OXC Parser + AST Import Rewriting)
              ▼
   [ Vite transform Hook ] ──► [ Cache Hit (Zero Latency) ]
              │
   [ Rolldown Module Graph ] ──► (16,000+ Fewer Modules via Direct Subpath Imports)
              │
              ▼
  [ renderChunk Hook Filter ] ──► [ CJS/ESM Interop Normalization ] (Pre-hash pattern patch)
              │
              ▼
  [ Deterministic Chunk Hash Generation ]
              │
              ▼
  [ generateBundle Hook ] ──► [ Parallel Worker Pool Obfuscation ] (Critical modules)
              │
              ▼
   [ closeBundle Hook ] ──► [ Native Dual Compression ] (libdeflater Gzip + Brotli via Rayon)
              │
              ▼
     [ Emitted Assets ] (.js, .css, .gz, .br)
```

### Thread-Local Bump Allocator

Standard AST compilers allocate nodes on the global heap using system `malloc`, incurring lock contention across threads when processing many files concurrently.

Magnon maintains thread-local bump allocation arenas (`ThreadLocalPool`). Each Rayon worker thread preserves a dedicated arena across transforms. Upon completing a module, the arena resets its pointer (`allocator.reset()`) without deallocating or reallocating OS virtual memory pages, keeping allocation latency near zero.

## Trade-offs and Considerations

- **Type Stripping vs. Type Checking**: Magnon strips TypeScript types during compilation, matching esbuild and SWC. It does not perform semantic type checking. Run `tsc --noEmit` in CI pipelines for type validation.
- **Fast Refresh in Development**: Magnon supports React JSX transformation in development mode (`development: true`). Hot Module Replacement (HMR) runtime client wiring is handled by Vite's development server.
- **Rolldown Interop Scope**: The CJS interop patch is specifically calibrated for Rolldown's module wrapping conventions in Vite 8. With traditional Rollup, standard `@rollup/plugin-commonjs` handles interop independently.
- **Worker Thread Overhead**: The `obfuscator()` plugin uses worker threads to avoid blocking the main event loop. For small projects with few chunks, worker thread initialization overhead may exceed obfuscation time. Enable it primarily for production release builds.

## License

MIT
