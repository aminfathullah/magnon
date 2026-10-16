# Magnon: Ultra-High Performance Rust TypeScript & JSX Toolchain

**Magnon** is an ultra-high performance TypeScript and JSX compiler, transformer, and Vite plugin written in pure Rust. Built to overcome memory allocation churn and Node-API FFI bottlenecks inherent in existing compilers, Magnon achieves blistering throughput on modern multi-core hardware.

---

## Fair Head-to-Head Benchmark: Maximum Setup vs Maximum Setup

Evaluated against the standard **853-file production corpus** in `benchmarks/fixtures` (753 Three.js production modules + 100 enterprise React/TypeScript components, totaling 4.62 MB source code) on an Intel Xeon Gold system (32 vCPUs, Linux x86_64, Node v25.9.0):

### Tier 1: Multi-Core Maximum Parallel Setup (All 32 Cores Saturated)

Every compiler configured with its maximum multi-threaded parallelism across all 32 hardware threads:

| Compiler / Toolchain | Cores | Wall Time (ms) | Throughput (files/sec) | Bandwidth (MB/s) | Speedup vs Rspack | vs SWC | vs esbuild | Pass Rate |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Magnon (Parallel Batch Engine)** | **32c** | **7.54 ms** | **113,096.6** | **613.19 MB/s** | **3.56x faster** | **13.94x faster** | **21.70x faster** | **853 / 853 (100%)** |
| **Rspack (`experiments.swc.transform`)** | 32c | 26.83 ms | 31,761.0 | 172.40 MB/s | 1.00x | 3.92x faster | 6.10x faster | 852 / 853 |
| **SWC (`swc.transform` Promise.all)** | 32c | 105.13 ms | 8,104.0 | 43.99 MB/s | 0.26x | 1.00x | 1.56x faster | 852 / 853 |
| **esbuild (`esbuild.transform` Promise.all)** | 32c | 163.66 ms | 5,205.9 | 28.26 MB/s | 0.16x | 0.64x | 1.00x | 852 / 853 |

### Tier 2: Single-Thread Baseline (1 Core Sequential Execution)

Pure single-core throughput isolating AST transformation and allocator efficiency:

| Compiler / Toolchain | Cores | Wall Time (ms) | Throughput (files/sec) | Bandwidth (MB/s) | Speedup vs Rspack | vs SWC | vs OXC | vs Babel |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Magnon (Single-File FFI)** | **1c** | **61.13 ms** | **13,937.5** | **75.65 MB/s** | **7.06x faster** | **6.69x faster** | **1.43x faster** | **42.06x faster** |
| **OXC (`oxc-transform`)** | 1c | 87.36 ms | 9,752.3 | 52.94 MB/s | 4.94x faster | 4.68x faster | 1.00x | 29.43x faster |
| **SWC (`@swc/core transformSync`)** | 1c | 408.91 ms | 2,083.6 | 11.31 MB/s | 1.06x faster | 1.00x | 0.21x | 6.29x faster |
| **Rspack (`@rspack/core transformSync`)** | 1c | 431.46 ms | 1,974.7 | 10.72 MB/s | 1.00x | 0.95x | 0.20x | 5.96x faster |
| **esbuild (`transformSync`)** | 1c | 942.78 ms | 903.7 | 4.91 MB/s | 0.46x | 0.43x | 0.09x | 2.73x faster |
| **Babel (`@babel/core`)** | 1c | 2,571.16 ms | 331.4 | 1.80 MB/s | 0.17x | 0.16x | 0.03x | 1.00x |

### Pure Native Rust Pipeline (`cargo run --release -p magnon-bench`)

Direct native comparison without Node runtime or V8 serialization:

| Engine Architecture | Setup | Wall Time (ms) | Throughput (files/sec) | Bandwidth (MB/sec) | vs OXC Baseline |
| :--- | :--- | :---: | :---: | :---: | :---: |
| **Standard OXC Pipeline** | 1 Core | 62.74 ms | 13,596.1 | 73.71 MB/s | 1.00x |
| **Magnon (Arena Reuse)** | 1 Core | 59.09 ms | 14,436.3 | 78.27 MB/s | 1.06x faster |
| **Standard OXC Pipeline (Max Parallel)** | 32 Cores Rayon | 3.91 ms | 217,890.2 | 1,181.35 MB/s | 16.03x faster |
| **Magnon (ThreadLocalPool Max Parallel)** | 32 Cores Rayon | **3.32 ms** | **256,559.1** | **1,391.01 MB/s** | **18.87x faster** |

---

## Why Magnon Leads Across Both Single-Core and Multi-Core

1. **Thread-Local Reusable Bump Arenas (`ThreadLocalPool`)**
   Instead of allocating and tearing down memory heaps for every module, Magnon maintains a reusable thread-local arena pool across worker threads. When a file finishes compilation, the bump allocator resets in a single CPU instruction, eliminating heap fragmentation and malloc/free syscall overhead.

2. **Single FFI Boundary Crossing**
   In Node.js, invoking `Promise.all` across hundreds of separate asynchronous promises still pays V8-to-C++ marshal overhead for each file. Magnon's `transformBatch` transfers the entire manifest in a single FFI crossing, executing all work inside native Rust before emitting results to V8.

3. **Multi-Threaded Work-Stealing Saturation (`rayon`)**
   Magnon divides compilation workloads across all available hardware threads via work-stealing queues, achieving near-linear scaling across high-core systems.

---

## Quickstart

### As a Vite Plugin

```javascript
import { defineConfig } from 'vite';
import magnon from 'magnon/vite';

export default defineConfig({
  plugins: [
    magnon({
      jsxRuntime: 'automatic',
      development: false,
    }),
  ],
});
```

### In Node.js / Scripts

```javascript
const { transform, transformBatch } = require('magnon');

const res = transform('const x: number = 42;', 'index.ts');
console.log(res.code);

const batch = transformBatch(['fixtures/App.tsx', 'fixtures/Button.tsx']);
console.log(`Transformed ${batch.successfulFiles} files in ${batch.wallTimeMs}ms`);
```

### As a Standalone CLI

```bash
./target/release/magnon transform src/**/*.tsx

node benchmarks/run_benchmark.js
cargo run --release -p magnon-bench
```

---

## Workspace Structure

- `crates/magnon-core`: Pure Rust high-performance AST parser, transformer, and thread-local arena pool.
- `crates/magnon-cli`: Standalone CLI binary for direct system compilation.
- `crates/magnon-node`: High-speed N-API bindings providing single-file and parallel batch APIs.
- `crates/magnon-bench`: Pure Rust benchmark suite with fair single-core and 32-core parallel comparisons against 853 files.
- `packages/magnon`: Complete npm package containing the Vite plugin, TypeScript definitions, CLI wrapper, and native addon.
- `benchmarks/`: Self-contained head-to-head benchmarking suite measuring Babel, SWC, Rspack, OXC, esbuild, and Magnon across Three.js and React components.
- `test/`: Integration test suite with local fixtures verifying single-file transforms, batch compilation, and Vite plugin hooks.
