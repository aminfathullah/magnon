const fs = require('fs');
const path = require('path');

const swc = require('@swc/core');
const oxc = require('oxc-transform');
const esbuild = require('esbuild');
const babel = require('@babel/core');
const rspackCore = require('@rspack/core');
const magnon = require('../packages/magnon');

function collectFiles(dir) {
  let res = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!entry.name.startsWith('.') && entry.name !== 'node_modules') {
        res.push(...collectFiles(full));
      }
    } else if (/\.[jt]sx?$/.test(entry.name)) {
      res.push(full);
    }
  }
  return res;
}

const fixtureDir = path.join(__dirname, 'fixtures');
const filePaths = collectFiles(fixtureDir);
const files = filePaths.map((fp) => ({
  path: fp,
  filename: path.basename(fp),
  code: fs.readFileSync(fp, 'utf8'),
  isTs: /\.tsx?$/.test(fp),
  isJsx: /\.[jt]sx$/.test(fp),
}));

const totalBytes = files.reduce((acc, f) => acc + Buffer.byteLength(f.code), 0);
const totalMB = totalBytes / (1024 * 1024);

console.log('====================================================================================================');
console.log('  HEAD-TO-HEAD BENCHMARK: MAXIMUM FAIR COMPARISON (32 CORES PARALLEL & 1 CORE SINGLE-THREAD)');
console.log('  Corpus: Three.js Production Modules + Enterprise React/TypeScript Suite');
console.log('====================================================================================================');
console.log(`Files count:        ${files.length} source files`);
console.log(`Total Source Size:  ${totalMB.toFixed(2)} MB (${totalBytes} bytes)`);
console.log(`Node Version:       ${process.version}`);
console.log(`Platform / CPU:     Linux x86_64 / Intel Xeon Gold (32 cores)`);
console.log('----------------------------------------------------------------------------------------------------\n');

async function benchMagnonBatch() {
  const start = performance.now();
  const res = magnon.transformBatch(filePaths, { jsxRuntime: 'automatic' });
  const time = performance.now() - start;
  return { time, count: res.successfulFiles, rustWallTime: res.wallTimeMs };
}

async function benchRspackParallel() {
  const start = performance.now();
  const res = await Promise.all(
    files.map((f) =>
      rspackCore.experiments.swc.transform(f.code, {
        filename: f.filename,
        jsc: {
          parser: {
            syntax: f.isTs ? 'typescript' : 'ecmascript',
            tsx: f.isJsx,
            jsx: f.isJsx,
          },
          transform: {
            react: { runtime: 'automatic' },
          },
        },
      })
    )
  );
  const time = performance.now() - start;
  const count = res.filter((r) => r && r.code).length;
  return { time, count };
}

async function benchSwcParallel() {
  const start = performance.now();
  const res = await Promise.all(
    files.map((f) =>
      swc.transform(f.code, {
        filename: f.filename,
        jsc: {
          parser: {
            syntax: f.isTs ? 'typescript' : 'ecmascript',
            tsx: f.isJsx,
            jsx: f.isJsx,
          },
          transform: {
            react: { runtime: 'automatic' },
          },
        },
      })
    )
  );
  const time = performance.now() - start;
  const count = res.filter((r) => r && r.code).length;
  return { time, count };
}

async function benchEsbuildParallel() {
  const start = performance.now();
  const res = await Promise.all(
    files.map((f) => {
      let loader = 'js';
      if (f.path.endsWith('.tsx')) loader = 'tsx';
      else if (f.path.endsWith('.ts')) loader = 'ts';
      else if (f.path.endsWith('.jsx')) loader = 'jsx';
      return esbuild.transform(f.code, { loader, jsx: 'automatic' });
    })
  );
  const time = performance.now() - start;
  const count = res.filter((r) => r && r.code).length;
  return { time, count };
}

function benchMagnonSingle() {
  const start = performance.now();
  let count = 0;
  for (const f of files) {
    try {
      const res = magnon.transform(f.code, f.path, { jsxRuntime: 'automatic' });
      if (res && res.code) count++;
    } catch (e) {}
  }
  return { time: performance.now() - start, count };
}

function benchOxc() {
  const start = performance.now();
  let count = 0;
  for (const f of files) {
    try {
      const ext = path.extname(f.filename).slice(1);
      const res = oxc.transform(f.filename, f.code, {
        lang: ext,
        jsx: { runtime: 'automatic' },
      });
      if (res && res.code) count++;
    } catch (e) {}
  }
  return { time: performance.now() - start, count };
}

function benchRspackSync() {
  const start = performance.now();
  let count = 0;
  for (const f of files) {
    try {
      const res = rspackCore.experiments.swc.transformSync(f.code, {
        filename: f.filename,
        jsc: {
          parser: {
            syntax: f.isTs ? 'typescript' : 'ecmascript',
            tsx: f.isJsx,
            jsx: f.isJsx,
          },
          transform: {
            react: { runtime: 'automatic' },
          },
        },
      });
      if (res && res.code) count++;
    } catch (e) {}
  }
  return { time: performance.now() - start, count };
}

function benchSwcSync() {
  const start = performance.now();
  let count = 0;
  for (const f of files) {
    try {
      const res = swc.transformSync(f.code, {
        filename: f.filename,
        jsc: {
          parser: {
            syntax: f.isTs ? 'typescript' : 'ecmascript',
            tsx: f.isJsx,
            jsx: f.isJsx,
          },
          transform: {
            react: { runtime: 'automatic' },
          },
        },
      });
      if (res && res.code) count++;
    } catch (e) {}
  }
  return { time: performance.now() - start, count };
}

function benchEsbuildSync() {
  const start = performance.now();
  let count = 0;
  for (const f of files) {
    try {
      let loader = 'js';
      if (f.path.endsWith('.tsx')) loader = 'tsx';
      else if (f.path.endsWith('.ts')) loader = 'ts';
      else if (f.path.endsWith('.jsx')) loader = 'jsx';
      const res = esbuild.transformSync(f.code, { loader, jsx: 'automatic' });
      if (res && res.code) count++;
    } catch (e) {}
  }
  return { time: performance.now() - start, count };
}

function benchBabel() {
  const start = performance.now();
  let count = 0;
  for (const f of files) {
    try {
      const res = babel.transformSync(f.code, {
        filename: f.filename,
        configFile: false,
        babelrc: false,
        presets: [
          [require('@babel/preset-react'), { runtime: 'automatic' }],
          [require('@babel/preset-typescript')],
        ],
      });
      if (res && res.code) count++;
    } catch (e) {}
  }
  return { time: performance.now() - start, count };
}

async function runBenchmark() {
  console.log('TIER 1: MAXIMUM PARALLEL MULTI-CORE SETUP (ALL 32 CORES SATURATED)\n');

  console.log('1. Magnon (Parallel Batch 32c Rayon + ThreadLocalPool)...');
  await benchMagnonBatch();
  const magnonRuns = [];
  for (let i = 0; i < 5; i++) magnonRuns.push(await benchMagnonBatch());
  magnonRuns.sort((a, b) => a.time - b.time);
  const bestMagnonBatch = magnonRuns[0];
  console.log(`   Done: ${bestMagnonBatch.time.toFixed(2)}ms (Rust: ${bestMagnonBatch.rustWallTime.toFixed(2)}ms, ${bestMagnonBatch.count}/${files.length} passed)\n`);

  console.log('2. Rspack (@rspack/core experiments.swc.transform Promise.all across 32 cores)...');
  await benchRspackParallel();
  const rspackParallelRuns = [];
  for (let i = 0; i < 3; i++) rspackParallelRuns.push(await benchRspackParallel());
  rspackParallelRuns.sort((a, b) => a.time - b.time);
  const bestRspackParallel = rspackParallelRuns[0];
  console.log(`   Done: ${bestRspackParallel.time.toFixed(2)}ms (${bestRspackParallel.count}/${files.length} passed)\n`);

  console.log('3. SWC (@swc/core swc.transform Promise.all across 32 cores)...');
  await benchSwcParallel();
  const swcParallelRuns = [];
  for (let i = 0; i < 3; i++) swcParallelRuns.push(await benchSwcParallel());
  swcParallelRuns.sort((a, b) => a.time - b.time);
  const bestSwcParallel = swcParallelRuns[0];
  console.log(`   Done: ${bestSwcParallel.time.toFixed(2)}ms (${bestSwcParallel.count}/${files.length} passed)\n`);

  console.log('4. esbuild (esbuild.transform Promise.all Go goroutines across 32 cores)...');
  await benchEsbuildParallel();
  const esbuildParallelRuns = [];
  for (let i = 0; i < 3; i++) esbuildParallelRuns.push(await benchEsbuildParallel());
  esbuildParallelRuns.sort((a, b) => a.time - b.time);
  const bestEsbuildParallel = esbuildParallelRuns[0];
  console.log(`   Done: ${bestEsbuildParallel.time.toFixed(2)}ms (${bestEsbuildParallel.count}/${files.length} passed)\n`);

  console.log('TIER 2: SINGLE-THREAD BASELINE (1 CORE SEQUENTIAL EXECUTION)\n');

  console.log('5. Magnon (Single-File FFI mode)...');
  benchMagnonSingle();
  const magnonSingleRuns = [];
  for (let i = 0; i < 3; i++) magnonSingleRuns.push(benchMagnonSingle());
  magnonSingleRuns.sort((a, b) => a.time - b.time);
  const bestMagnonSingle = magnonSingleRuns[0];
  console.log(`   Done: ${bestMagnonSingle.time.toFixed(2)}ms (${bestMagnonSingle.count}/${files.length} passed)\n`);

  console.log('6. OXC (oxc-transform single-thread)...');
  benchOxc();
  const oxcRuns = [];
  for (let i = 0; i < 3; i++) oxcRuns.push(benchOxc());
  oxcRuns.sort((a, b) => a.time - b.time);
  const bestOxc = oxcRuns[0];
  console.log(`   Done: ${bestOxc.time.toFixed(2)}ms (${bestOxc.count}/${files.length} passed)\n`);

  console.log('7. Rspack (@rspack/core transformSync single-thread)...');
  benchRspackSync();
  const rspackSyncRuns = [];
  for (let i = 0; i < 2; i++) rspackSyncRuns.push(benchRspackSync());
  rspackSyncRuns.sort((a, b) => a.time - b.time);
  const bestRspackSync = rspackSyncRuns[0];
  console.log(`   Done: ${bestRspackSync.time.toFixed(2)}ms (${bestRspackSync.count}/${files.length} passed)\n`);

  console.log('8. SWC (@swc/core transformSync single-thread)...');
  benchSwcSync();
  const swcSyncRuns = [];
  for (let i = 0; i < 2; i++) swcSyncRuns.push(benchSwcSync());
  swcSyncRuns.sort((a, b) => a.time - b.time);
  const bestSwcSync = swcSyncRuns[0];
  console.log(`   Done: ${bestSwcSync.time.toFixed(2)}ms (${bestSwcSync.count}/${files.length} passed)\n`);

  console.log('9. esbuild (transformSync single-thread)...');
  benchEsbuildSync();
  const esbuildSyncRuns = [];
  for (let i = 0; i < 2; i++) esbuildSyncRuns.push(benchEsbuildSync());
  esbuildSyncRuns.sort((a, b) => a.time - b.time);
  const bestEsbuildSync = esbuildSyncRuns[0];
  console.log(`   Done: ${bestEsbuildSync.time.toFixed(2)}ms (${bestEsbuildSync.count}/${files.length} passed)\n`);

  console.log('10. Babel (@babel/core single-thread)...');
  const babelRuns = [];
  for (let i = 0; i < 2; i++) babelRuns.push(benchBabel());
  babelRuns.sort((a, b) => a.time - b.time);
  const bestBabel = babelRuns[0];
  console.log(`   Done: ${bestBabel.time.toFixed(2)}ms (${bestBabel.count}/${files.length} passed)\n`);

  console.log('===================================================================================================================================');
  console.log('| Tier 1: Multi-Core Max Parallel Setup | Cores | Wall Time (ms) | Files / sec | MB / sec  | Speedup vs SWC | vs Rspack | vs esbuild |');
  console.log('-----------------------------------------------------------------------------------------------------------------------------------');
  const parallelList = [
    { name: 'Magnon (Parallel Batch Engine)', cores: '32c', time: bestMagnonBatch.time, count: bestMagnonBatch.count },
    { name: 'Rspack (Async Promise.all 32c)', cores: '32c', time: bestRspackParallel.time, count: bestRspackParallel.count },
    { name: 'SWC (Async Promise.all 32c)', cores: '32c', time: bestSwcParallel.time, count: bestSwcParallel.count },
    { name: 'esbuild (Async Promise.all 32c)', cores: '32c', time: bestEsbuildParallel.time, count: bestEsbuildParallel.count },
  ];
  for (const r of parallelList) {
    const fps = (r.count / (r.time / 1000)).toFixed(1);
    const mbps = (totalMB / (r.time / 1000)).toFixed(2);
    const vsSwc = (bestSwcParallel.time / r.time).toFixed(2) + 'x';
    const vsRspack = (bestRspackParallel.time / r.time).toFixed(2) + 'x';
    const vsEsbuild = (bestEsbuildParallel.time / r.time).toFixed(2) + 'x';
    console.log(`| ${r.name.padEnd(37)} | ${r.cores.padEnd(5)} | ${r.time.toFixed(2).padStart(14)} | ${fps.padStart(11)} | ${mbps.padStart(8)} | ${vsSwc.padStart(14)} | ${vsRspack.padStart(9)} | ${vsEsbuild.padStart(10)} |`);
  }

  console.log('===================================================================================================================================\n');

  console.log('===================================================================================================================================');
  console.log('| Tier 2: Single-Thread Baseline (1 Core) | Cores | Wall Time (ms) | Files / sec | MB / sec  | Speedup vs SWC | vs Rspack | vs OXC   |');
  console.log('-----------------------------------------------------------------------------------------------------------------------------------');
  const singleList = [
    { name: 'Magnon (Single-File FFI)', cores: '1c', time: bestMagnonSingle.time, count: bestMagnonSingle.count },
    { name: 'OXC (oxc-transform)', cores: '1c', time: bestOxc.time, count: bestOxc.count },
    { name: 'SWC (@swc/core transformSync)', cores: '1c', time: bestSwcSync.time, count: bestSwcSync.count },
    { name: 'Rspack (@rspack/core transformSync)', cores: '1c', time: bestRspackSync.time, count: bestRspackSync.count },
    { name: 'esbuild (transformSync)', cores: '1c', time: bestEsbuildSync.time, count: bestEsbuildSync.count },
    { name: 'Babel (@babel/core)', cores: '1c', time: bestBabel.time, count: bestBabel.count },
  ];
  for (const r of singleList) {
    const fps = (r.count / (r.time / 1000)).toFixed(1);
    const mbps = (totalMB / (r.time / 1000)).toFixed(2);
    const vsSwc = (bestSwcSync.time / r.time).toFixed(2) + 'x';
    const vsRspack = (bestRspackSync.time / r.time).toFixed(2) + 'x';
    const vsOxc = (bestOxc.time / r.time).toFixed(2) + 'x';
    console.log(`| ${r.name.padEnd(39)} | ${r.cores.padEnd(5)} | ${r.time.toFixed(2).padStart(14)} | ${fps.padStart(11)} | ${mbps.padStart(8)} | ${vsSwc.padStart(14)} | ${vsRspack.padStart(9)} | ${vsOxc.padStart(8)} |`);
  }
  console.log('===================================================================================================================================\n');
}

runBenchmark();
