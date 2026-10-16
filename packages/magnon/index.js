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

const FRAMEWORK_PRESETS = {
  react: {
    name: "core-vendor",
    test: /[\\/]node_modules[\\/](react|react-dom|scheduler|prop-types|use-sync-external-store|hoist-non-react-statics|@emotion|redux|react-redux|@reduxjs|immer|@popperjs)[\\/]/,
    priority: 50,
    packages: [
      "/react/", "/react-dom/", "/react@", "/react-dom@",
      "/@emotion/", "/react-is", "/react-transition-group",
      "/redux", "/react-redux", "/scheduler", "/prop-types",
      "/use-sync-external-store", "/hoist-non-react-statics",
      "/@popperjs/", "/popper.js/", "/immer/", "/@reduxjs/"
    ]
  },
  vue: {
    name: "core-vendor",
    test: /[\\/]node_modules[\\/](vue|@vue|vue-router|pinia|vuex)[\\/]/,
    priority: 50,
    packages: ["/vue/", "/@vue/", "/vue-router/", "/pinia/", "/vuex/"]
  },
  svelte: {
    name: "core-vendor",
    test: /[\\/]node_modules[\\/](svelte|@sveltejs)[\\/]/,
    priority: 50,
    packages: ["/svelte/", "/@sveltejs/"]
  }
};

function codeSplitting(options = {}) {
  let framework = options.framework;
  if (!framework && options.framework !== false) {
    framework = "react";
  }

  const customGroups = options.groups || [];
  const chunks = options.chunks || (options.vendors ? options.vendors : {});
  if (!options.chunks && !options.vendors && !options.groups && !options.framework) {
    Object.entries(options).forEach(([k, v]) => {
      if (k !== "framework" && k !== "groups" && k !== "chunks" && k !== "vendors" && k !== "priority") {
        chunks[k] = v;
      }
    });
  }

  const rolldownGroups = [];
  let basePriority = 40;

  if (framework && FRAMEWORK_PRESETS[framework]) {
    rolldownGroups.push({
      name: FRAMEWORK_PRESETS[framework].name,
      test: FRAMEWORK_PRESETS[framework].test,
      priority: FRAMEWORK_PRESETS[framework].priority
    });
  }

  Object.entries(chunks).forEach(([chunkName, pkgs]) => {
    const pkgList = Array.isArray(pkgs) ? pkgs : [pkgs];
    const escaped = pkgList.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
    const regex = new RegExp(`[\\/]node_modules[\\/](${escaped})`);
    rolldownGroups.push({
      name: chunkName,
      test: regex,
      priority: Math.max(10, basePriority)
    });
    basePriority -= 5;
  });

  customGroups.forEach((g) => {
    rolldownGroups.push(g);
  });

  const manualChunksFn = function manualChunks(id) {
    if (!id.includes("node_modules")) return;
    const pkgPath = id.slice(id.lastIndexOf("node_modules/"));

    if (framework && FRAMEWORK_PRESETS[framework]) {
      const fwPkgs = FRAMEWORK_PRESETS[framework].packages;
      for (const p of fwPkgs) {
        if (pkgPath.includes(p)) return FRAMEWORK_PRESETS[framework].name;
      }
    }

    for (const [chunkName, pkgs] of Object.entries(chunks)) {
      const pkgList = Array.isArray(pkgs) ? pkgs : [pkgs];
      for (const p of pkgList) {
        if (pkgPath.includes(p)) return chunkName;
      }
    }
  };

  manualChunksFn.groups = rolldownGroups;
  manualChunksFn.manualChunks = manualChunksFn;
  return manualChunksFn;
}

function splitChunks(rules = {}) {
  return codeSplitting(rules);
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
  const codeSplitOpts = options.codeSplitting || options.splitChunks;
  const optimizePackageImports = options.optimizePackageImports === false
    ? []
    : (Array.isArray(options.optimizePackageImports)
        ? options.optimizePackageImports
        : [
            "@tabler/icons-react",
            "@mui/material",
            "@mui/icons-material",
            "@mui/lab",
            "lucide-react",
            "@heroicons/react/24/outline",
            "@heroicons/react/24/solid",
            "@phosphor-icons/react",
            "lodash",
            "lodash-es",
            "date-fns",
            "ramda",
            "react-bootstrap",
            "antd",
            "recharts",
            "rxjs",
          ]);
  const modularizeImports = options.modularizeImports || {};
  const cache = new Map();
  let resolvedConfig;

  return {
    name: "vite-plugin-magnon",
    enforce: "pre",

    config(config) {
      const cfg = {
        esbuild: false,
        oxc: false,
        resolve: {
          alias: [
            { find: /^@mui\/icons-material\/(?!esm\/)(.*)/, replacement: "@mui/icons-material/esm/$1" },
            { find: /^@mui\/icons-material$/, replacement: "@mui/icons-material/esm" }
          ]
        },
        build: {
          rolldownOptions: {
            onwarn(warning, defaultHandler) {
              if (warning.code === "MODULE_LEVEL_DIRECTIVE") return;
              defaultHandler(warning);
            }
          }
        }
      };

      if (codeSplitOpts) {
        const splitHelper = typeof codeSplitOpts === "object" ? codeSplitting(codeSplitOpts) : codeSplitting();
        cfg.build.rolldownOptions.output = {
          codeSplitting: {
            groups: splitHelper.groups
          }
        };
        cfg.build.rollupOptions = {
          output: {
            manualChunks: splitHelper.manualChunks
          }
        };
      }

      return cfg;
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
module.exports.codeSplitting = codeSplitting;
module.exports.obfuscator = obfuscator;
module.exports.obfuscate = obfuscator;
module.exports.transform = transform;
module.exports.transformBatch = transformBatch;
module.exports.compressGzip = compressGzip;
module.exports.compressBrotli = compressBrotli;
module.exports.compressDirectory = compressDirectory;
module.exports.compressFiles = compressFiles;
