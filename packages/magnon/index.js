const path = require("path");
const fs = require("fs");
const { Worker } = require("worker_threads");
const os = require("os");

let nativeAddon;
try {
  nativeAddon = require("./magnon.node");
} catch (e) {
  try {
    nativeAddon = require(path.join(__dirname, "../../target/release/magnon.node"));
  } catch (err) {
    throw new Error("Failed to load native Magnon binary: " + err.message);
  }
}

const {
  transform,
  transformBatch,
  compressGzip,
  compressBrotli,
  compressDirectory,
  compressFiles,
} = nativeAddon;

function compression(options = {}) {
  let resolvedConfig;
  return {
    name: "vite-plugin-magnon-compression",
    apply: "build",
    enforce: "post",
    configResolved(config) {
      resolvedConfig = config;
    },
    closeBundle() {
      const root = resolvedConfig?.root || process.cwd();
      const outDir = path.resolve(root, resolvedConfig?.build?.outDir || "dist");
      if (!fs.existsSync(outDir)) return;

      const res = compressDirectory(outDir, {
        gzip: options.gzip !== false,
        brotli: options.brotli !== false,
        gzipLevel: options.gzipLevel ?? 6,
        brotliQuality: options.brotliQuality ?? 5,
        threshold: options.threshold ?? 1024,
        extensions: options.extensions,
        deleteOriginal: options.deleteOriginal ?? false,
      });

      if (options.verbose !== false && res.totalFiles > 0) {
        const origMb = (res.totalOriginalBytes / 1024 / 1024).toFixed(2);
        const gzMb = (res.totalGzipBytes / 1024 / 1024).toFixed(2);
        const brMb = (res.totalBrotliBytes / 1024 / 1024).toFixed(2);
        console.log(`\x1b[32m✓\x1b[0m [magnon] Compressed ${res.totalFiles} assets in ${res.durationMs.toFixed(1)}ms (${origMb}MB -> gz: ${gzMb}MB, br: ${brMb}MB)`);
      }
    },
  };
}

function splitChunks(rules = {}) {
  const entries = Object.entries(rules);
  return function manualChunks(id) {
    if (!id.includes("node_modules")) return;
    for (const [chunkName, pkgs] of entries) {
      if (Array.isArray(pkgs)) {
        for (const pkg of pkgs) {
          if (id.includes(pkg)) return chunkName;
        }
      } else if (typeof pkgs === "string" && id.includes(pkgs)) {
        return chunkName;
      }
    }
  };
}

function obfuscator(pluginOptions = {}) {
  const enable = pluginOptions.enable !== false;
  if (!enable) {
    return { name: "vite-plugin-magnon-obfuscator" };
  }

  const minChunkSize = pluginOptions.minChunkSize ?? (8 * 1024);
  const criticalFragments = pluginOptions.criticalModuleFragments || [];
  const workerCount = pluginOptions.threads || Math.min(os.cpus().length || 4, 8);
  const obfOptions = pluginOptions.options || {};
  const verbose = pluginOptions.verbose !== false;

  let workers = [];
  const readyPromises = [];

  const workerScript = `
    const { parentPort, workerData } = require("worker_threads");
    const JavaScriptObfuscator = require(workerData.pkgPath);
    parentPort.postMessage({ ready: true });

    parentPort.on("message", ({ id, code, options }) => {
      try {
        const res = JavaScriptObfuscator.obfuscate(code, options).getObfuscatedCode();
        parentPort.postMessage({ id, code: res });
      } catch (err) {
        parentPort.postMessage({ id, error: err.message });
      }
    });
  `;

  return {
    name: "vite-plugin-magnon-obfuscator",
    apply: "build",
    enforce: "post",

    buildStart() {
      let pkgPath;
      try {
        pkgPath = require.resolve("javascript-obfuscator", { paths: [process.cwd(), __dirname] });
      } catch (e) {
        return;
      }

      for (let i = 0; i < workerCount; i++) {
        const w = new Worker(workerScript, { eval: true, workerData: { pkgPath } });
        readyPromises.push(new Promise((resolve) => {
          w.once("message", () => resolve(w));
        }));
        workers.push(w);
      }
    },

    async generateBundle(_, bundle) {
      if (workers.length === 0) return;
      await Promise.all(readyPromises);

      const normalize = (id) => id.split(path.sep).join("/");
      const collect = (fileName, seen = new Set()) => {
        if (seen.has(fileName)) return seen;
        const c = bundle[fileName];
        if (!c || c.type !== "chunk") return seen;
        seen.add(fileName);
        c.imports.forEach((imp) => collect(imp, seen));
        return seen;
      };

      const startup = Object.values(bundle).reduce((acc, c) => {
        if (c.type === "chunk" && c.isEntry) collect(c.fileName, acc);
        return acc;
      }, new Set());

      const critical = Object.values(bundle).reduce((acc, c) => {
        if (c.type !== "chunk") return acc;
        const mods = Object.keys(c.modules || {}).map(normalize);
        if (criticalFragments.some((frag) => mods.some((m) => m.includes(frag)))) {
          collect(c.fileName, acc);
        }
        return acc;
      }, new Set());

      const tasks = [];
      Object.entries(bundle).forEach(([fileName, output]) => {
        if (
          output.type !== "chunk" ||
          startup.has(fileName) ||
          critical.has(fileName) ||
          output.code.length < minChunkSize
        ) {
          return;
        }

        const mods = Object.keys(output.modules || {}).map(normalize);
        const hasApp = mods.some((m) => m.includes("/src/"));
        const hasVendor = mods.some((m) => m.includes("/node_modules/"));
        if (!hasApp || hasVendor) return;

        tasks.push({ fileName, output });
      });

      if (tasks.length === 0) return;

      const t0 = performance.now();
      let taskIdx = 0;
      let completed = 0;

      await new Promise((resolve, reject) => {
        const dispatch = (worker) => {
          if (taskIdx >= tasks.length) {
            if (completed === tasks.length) resolve();
            return;
          }
          const task = tasks[taskIdx++];
          worker.postMessage({
            id: task.fileName,
            code: task.output.code,
            options: { ...obfOptions, inputFileName: task.fileName }
          });
        };

        workers.forEach((w) => {
          w.on("message", (msg) => {
            if (msg.ready) return;
            const targetTask = tasks.find((t) => t.fileName === msg.id);
            if (targetTask && msg.code) {
              targetTask.output.code = msg.code;
            }
            completed++;
            dispatch(w);
          });
          w.on("error", reject);
          dispatch(w);
        });
      });

      const dt = performance.now() - t0;
      if (verbose) {
        console.log(`\x1b[32m✓\x1b[0m [magnon] Parallel obfuscated ${tasks.length} chunks across ${workers.length} workers in ${dt.toFixed(1)}ms`);
      }
    },

    closeBundle() {
      workers.forEach((w) => w.terminate());
      workers = [];
    }
  };
}

function magnonPlugin(options = {}) {
  const filter = options.include || /\.[jt]sx?$/;
  const exclude = options.exclude || /node_modules/;
  const prewarm = options.prewarm !== false;
  const compressOpts = options.compress === true ? {} : options.compress;
  const optimizePackageImports = options.optimizePackageImports === false
    ? []
    : (Array.isArray(options.optimizePackageImports)
        ? options.optimizePackageImports
        : [
            "@tabler/icons-react",
            "@mui/material",
            "@mui/icons-material",
            "@mui/lab",
            "lodash",
            "lodash-es",
            "date-fns",
          ]);
  const modularizeImports = options.modularizeImports || {};
  const cache = new Map();
  let resolvedConfig;

  return {
    name: "vite-plugin-magnon",
    enforce: "pre",

    config(config) {
      return {
        esbuild: false,
        oxc: false,
        build: {
          rolldownOptions: {
            onwarn(warning, defaultHandler) {
              if (warning.code === "MODULE_LEVEL_DIRECTIVE") return;
              defaultHandler(warning);
            }
          }
        }
      };
    },

    configResolved(config) {
      resolvedConfig = config;
    },

    buildStart() {
      if (!prewarm) return;
      const root = resolvedConfig?.root || process.cwd();
      const srcDir = path.join(root, "src");
      if (!fs.existsSync(srcDir)) return;

      const collect = (dir) => {
        const out = [];
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            if (!entry.name.startsWith(".") && entry.name !== "node_modules") {
              out.push(...collect(full));
            }
          } else if (filter.test(entry.name)) {
            out.push(full);
          }
        }
        return out;
      };

      const files = collect(srcDir);
      if (files.length === 0) return;

      const batchRes = transformBatch(files, {
        jsxRuntime: options.jsxRuntime || "automatic",
        development: options.development || false,
        refresh: options.refresh || false,
        sourcemap: options.sourcemap || false,
        optimizePackageImports,
        modularizeImports,
      });

      for (const item of batchRes.files) {
        if (item.success && item.outputCode) {
          cache.set(item.path, {
            code: item.outputCode,
            map: null,
          });
        }
      }
    },

    transform(code, id) {
      const cleanId = id.split("?")[0];
      if (exclude.test(cleanId) || !filter.test(cleanId)) {
        return null;
      }

      const cached = cache.get(cleanId);
      if (cached) {
        cache.delete(cleanId);
        return cached;
      }

      try {
        const res = transform(code, cleanId, {
          jsxRuntime: options.jsxRuntime || "automatic",
          development: options.development || false,
          refresh: options.refresh || false,
          sourcemap: options.sourcemap || false,
          optimizePackageImports,
          modularizeImports,
        });
        return {
          code: res.code,
          map: res.map ? JSON.parse(res.map) : null,
        };
      } catch (err) {
        this.error(`[magnon] Transform error in ${cleanId}: ${err.message}`);
      }
    },

    closeBundle() {
      if (!compressOpts) return;
      const root = resolvedConfig?.root || process.cwd();
      const outDir = path.resolve(root, resolvedConfig?.build?.outDir || "dist");
      if (!fs.existsSync(outDir)) return;

      const res = compressDirectory(outDir, {
        gzip: compressOpts.gzip !== false,
        brotli: compressOpts.brotli !== false,
        gzipLevel: compressOpts.gzipLevel ?? 6,
        brotliQuality: compressOpts.brotliQuality ?? 5,
        threshold: compressOpts.threshold ?? 1024,
        extensions: compressOpts.extensions,
        deleteOriginal: compressOpts.deleteOriginal ?? false,
      });

      if (compressOpts.verbose !== false && res.totalFiles > 0) {
        const origMb = (res.totalOriginalBytes / 1024 / 1024).toFixed(2);
        const gzMb = (res.totalGzipBytes / 1024 / 1024).toFixed(2);
        const brMb = (res.totalBrotliBytes / 1024 / 1024).toFixed(2);
        console.log(`\x1b[32m✓\x1b[0m [magnon] Compressed ${res.totalFiles} assets in ${res.durationMs.toFixed(1)}ms (${origMb}MB -> gz: ${gzMb}MB, br: ${brMb}MB)`);
      }
    },
  };
}

module.exports = magnonPlugin;
module.exports.default = magnonPlugin;
module.exports.magnon = magnonPlugin;
module.exports.compression = compression;
module.exports.compress = compression;
module.exports.splitChunks = splitChunks;
module.exports.obfuscator = obfuscator;
module.exports.obfuscate = obfuscator;
module.exports.transform = transform;
module.exports.transformBatch = transformBatch;
module.exports.compressGzip = compressGzip;
module.exports.compressBrotli = compressBrotli;
module.exports.compressDirectory = compressDirectory;
module.exports.compressFiles = compressFiles;
