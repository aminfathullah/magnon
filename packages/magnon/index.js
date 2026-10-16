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
    test: /[\\/]node_modules[\\/](react|react-dom|scheduler|prop-types|use-sync-external-store|hoist-non-react-statics|react-is)[\\/]/,
    priority: 50,
    packages: [
      "/react/", "/react-dom/", "/react@", "/react-dom@",
      "/react-is/", "/scheduler/", "/prop-types/",
      "/use-sync-external-store/", "/hoist-non-react-statics/"
    ]
  },
  vue: {
    name: "core-vendor",
    test: /[\\/]node_modules[\\/](vue|@vue\/runtime-core|@vue\/runtime-dom|@vue\/reactivity|@vue\/shared)[\\/]/,
    priority: 50,
    packages: [
      "/vue/", "/@vue/runtime-core/", "/@vue/runtime-dom/",
      "/@vue/reactivity/", "/@vue/shared/"
    ]
  },
  svelte: {
    name: "core-vendor",
    test: /[\\/]node_modules[\\/]svelte[\\/]/,
    priority: 50,
    packages: ["/svelte/"]
  },
  preact: {
    name: "core-vendor",
    test: /[\\/]node_modules[\\/]preact[\\/]/,
    priority: 50,
    packages: ["/preact/"]
  },
  solid: {
    name: "core-vendor",
    test: /[\\/]node_modules[\\/]solid-js[\\/]/,
    priority: 50,
    packages: ["/solid-js/"]
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
      if (k !== "framework" && k !== "groups" && k !== "chunks" && k !== "vendors" && k !== "priority" && k !== "frameworkChunkName") {
        chunks[k] = v;
      }
    });
  }

  const rolldownGroups = [];
  let basePriority = 40;
  const frameworkName = options.frameworkChunkName || (framework && FRAMEWORK_PRESETS[framework] ? FRAMEWORK_PRESETS[framework].name : "core-vendor");

  if (framework && FRAMEWORK_PRESETS[framework]) {
    rolldownGroups.push({
      name: frameworkName,
      test: FRAMEWORK_PRESETS[framework].test,
      priority: FRAMEWORK_PRESETS[framework].priority
    });
  }

  Object.entries(chunks).forEach(([chunkName, chunkDef]) => {
    let testPattern;
    let chunkPriority = Math.max(10, basePriority);
    let pkgList = [];

    if (chunkDef && typeof chunkDef === "object" && !Array.isArray(chunkDef) && chunkDef.test) {
      if (typeof chunkDef.priority === "number") {
        chunkPriority = chunkDef.priority;
      }
      if (chunkDef.test instanceof RegExp) {
        testPattern = chunkDef.test;
      } else {
        pkgList = Array.isArray(chunkDef.test) ? chunkDef.test : [chunkDef.test];
      }
    } else {
      pkgList = Array.isArray(chunkDef) ? chunkDef : [chunkDef];
    }

    if (!testPattern) {
      const escaped = pkgList.map((p) => (typeof p === "string" ? p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : "")).filter(Boolean).join("|");
      testPattern = new RegExp(`[\\/]node_modules[\\/](${escaped})`);
    }

    rolldownGroups.push({
      name: chunkName,
      test: testPattern,
      priority: chunkPriority
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
        if (pkgPath.includes(p)) return frameworkName;
      }
    }

    for (const [chunkName, chunkDef] of Object.entries(chunks)) {
      if (chunkDef && typeof chunkDef === "object" && !Array.isArray(chunkDef) && chunkDef.test) {
        if (chunkDef.test instanceof RegExp && chunkDef.test.test(id)) {
          return chunkName;
        }
        const list = Array.isArray(chunkDef.test) ? chunkDef.test : [chunkDef.test];
        for (const p of list) {
          if (typeof p === "string" && pkgPath.includes(p)) return chunkName;
        }
      } else {
        const pkgList = Array.isArray(chunkDef) ? chunkDef : [chunkDef];
        for (const p of pkgList) {
          if (typeof p === "string" && pkgPath.includes(p)) return chunkName;
        }
      }
    }
  };

  manualChunksFn.groups = rolldownGroups;
  manualChunksFn.manualChunks = manualChunksFn;
  return {
    groups: rolldownGroups,
    manualChunks: manualChunksFn,
  };
}

function splitChunks(rules = {}) {
  const res = codeSplitting(rules);
  return res.manualChunks;
}

function matchesPattern(str, pattern) {
  if (!pattern) return false;
  if (pattern instanceof RegExp) return pattern.test(str);
  if (typeof pattern === "string") return str.includes(pattern);
  if (typeof pattern === "function") return Boolean(pattern(str));
  if (Array.isArray(pattern)) return pattern.some((p) => matchesPattern(str, p));
  return false;
}

function createAntiDebugTrap(interval = 2000) {
  return `(function(){if(typeof window==="undefined")return;var _g=typeof window!=="undefined"?window:(typeof globalThis!=="undefined"?globalThis:self);if(!_g||!_g.document)return;function _trap(c){if(typeof c!=="number")c=0;if(c>30)return;try{(function(){return!0;}["constructor"]("debu"+"gger")["call"]("action"));}catch(_){}_trap(c+1);}function _check(){var t=Date.now();(function(){return!0;}["constructor"]("debu"+"gger")["call"]("action"));if(Date.now()-t>100){try{console.clear();}catch(_){}_trap(0);}}function _checkDock(){try{var wd=_g.outerWidth-_g.innerWidth,hd=_g.outerHeight-_g.innerHeight;if(wd>160||hd>160){try{console.clear();}catch(_){}_trap(0);}}catch(_){}}try{_check();_checkDock();setInterval(_check,${interval});setInterval(_checkDock,${Math.max(500, Math.floor(interval / 2))});_g.addEventListener("resize",_checkDock);_g.addEventListener("focus",_check);_g.addEventListener("keydown",function(e){if(e.key==="F12"||((e.ctrlKey||e.metaKey)&&e.shiftKey&&(e.key==="I"||e.key==="i"||e.key==="J"||e.key==="j"||e.key==="C"||e.key==="c"))||((e.ctrlKey||e.metaKey)&&(e.key==="U"||e.key==="u"))||((e.ctrlKey||e.metaKey)&&(e.key==="S"||e.key==="s"))){try{e.preventDefault();e.stopPropagation();}catch(_){}_trap(0);}},true);}catch(_){}})();\n`;
}

function obfuscator(pluginOptions = {}) {
  const enable = pluginOptions.enable !== false;
  if (!enable) {
    return { name: "vite-plugin-magnon-obfuscator" };
  }

  const include = pluginOptions.include;
  const exclude = pluginOptions.exclude;
  const autoExcludeNodeModules = pluginOptions.autoExcludeNodeModules !== false;
  const obfuscateEntry = pluginOptions.obfuscateEntry !== false;
  const criticalFragments = pluginOptions.criticalModuleFragments || [];
  const minChunkSize = pluginOptions.minChunkSize ?? 0;
  const workerCount = pluginOptions.threads || Math.min(os.cpus()?.length || 4, 8);
  const verbose = pluginOptions.verbose !== false;

  const obfOptions = Object.assign({}, pluginOptions.options || {});
  const topLevelKeys = [
    "compact", "controlFlowFlattening", "controlFlowFlatteningThreshold",
    "deadCodeInjection", "deadCodeInjectionThreshold", "debugProtection",
    "debugProtectionInterval", "disableConsoleOutput", "identifierNamesGenerator",
    "identifiersPrefix", "ignoreImports", "log", "numbersToExpressions",
    "renameGlobals", "selfDefending", "simplify", "splitStrings",
    "splitStringsChunkLength", "stringArray", "stringArrayCallsTransform",
    "stringArrayCallsTransformThreshold", "stringArrayEncoding",
    "stringArrayIndexShift", "stringArrayRotate", "stringArrayShuffle",
    "stringArrayWrappersCount", "stringArrayWrappersChainedCalls",
    "stringArrayWrappersParametersMaxCount", "stringArrayWrappersType",
    "stringArrayThreshold", "target", "transformObjectKeys", "unicodeEscapeSequence"
  ];

  for (const k of topLevelKeys) {
    if (pluginOptions[k] !== undefined && obfOptions[k] === undefined) {
      obfOptions[k] = pluginOptions[k];
    }
  }

  const hasDebugProtection = Boolean(
    obfOptions.debugProtection !== undefined ? obfOptions.debugProtection : (pluginOptions.debugProtection !== undefined ? pluginOptions.debugProtection : pluginOptions.options?.debugProtection)
  );
  let debugInterval = 2000;
  const rawInterval = obfOptions.debugProtectionInterval ?? pluginOptions.debugProtectionInterval ?? pluginOptions.options?.debugProtectionInterval;
  if (typeof rawInterval === "number" && rawInterval > 0) {
    debugInterval = Math.floor(rawInterval);
  }
  obfOptions.debugProtection = false;
  delete obfOptions.debugProtectionInterval;

  const userReserved = Array.isArray(obfOptions.reservedNames) ? obfOptions.reservedNames : [];
  const defaultReserved = ["^[a-zA-Z]$", "^_[a-zA-Z]$", "^__.*"];
  obfOptions.reservedNames = Array.from(new Set([...defaultReserved, ...userReserved]));

  if (obfOptions.ignoreImports === undefined) {
    obfOptions.ignoreImports = true;
  }
  if (!obfOptions.target) {
    obfOptions.target = "browser";
  }

  let workers = [];
  const readyPromises = [];
  let pkgPath = null;
  let hasResolvedPkg = false;

  const workerScript = `
    const { parentPort, workerData } = require("worker_threads");
    const JavaScriptObfuscator = require(workerData.pkgPath);
    parentPort.postMessage({ type: "ready" });

    parentPort.on("message", ({ id, code, options }) => {
      try {
        const res = JavaScriptObfuscator.obfuscate(code, options);
        parentPort.postMessage({
          id,
          success: true,
          code: res.getObfuscatedCode(),
          map: options.sourceMap ? res.getSourceMap() : null
        });
      } catch (err) {
        parentPort.postMessage({
          id,
          success: false,
          error: err ? (err.stack || err.message) : "Obfuscation failed"
        });
      }
    });
  `;

  function resolvePackage() {
    if (hasResolvedPkg) return pkgPath;
    hasResolvedPkg = true;
    const lookupDirs = [process.cwd(), __dirname];
    let curr = process.cwd();
    for (let i = 0; i < 4; i++) {
      const parent = path.dirname(curr);
      if (parent === curr) break;
      lookupDirs.push(parent);
      curr = parent;
    }
    try {
      pkgPath = require.resolve("javascript-obfuscator", { paths: lookupDirs });
    } catch (_) {
      pkgPath = null;
    }
    return pkgPath;
  }

  return {
    name: "vite-plugin-magnon-obfuscator",
    apply: "build",
    enforce: "post",

    buildStart() {
      const resolved = resolvePackage();
      if (!resolved) {
        if (verbose) {
          console.warn("\x1b[33m!\x1b[0m [magnon] 'javascript-obfuscator' package not found. Skipping obfuscation. (Install it via 'pnpm add -D javascript-obfuscator')");
        }
        return;
      }

      if (workerCount > 1) {
        for (let i = 0; i < workerCount; i++) {
          try {
            const w = new Worker(workerScript, { eval: true, workerData: { pkgPath: resolved } });
            readyPromises.push(new Promise((res) => {
              const onMsg = (msg) => {
                if (msg && msg.type === "ready") {
                  w.off("message", onMsg);
                  res(w);
                }
              };
              w.on("message", onMsg);
            }));
            workers.push(w);
          } catch (_) {
            break;
          }
        }
      }
    },

    async generateBundle(outputOptions, bundle) {
      const resolved = resolvePackage();
      if (!resolved) return;

      const tasks = [];
      const normalize = (id) => id.split(path.sep).join("/");

      for (const [fileName, output] of Object.entries(bundle)) {
        if (!output || output.type !== "chunk" || typeof output.code !== "string") {
          continue;
        }

        const mods = Object.keys(output.modules || {}).map(normalize);
        const isCritical = criticalFragments.length > 0 && criticalFragments.some((frag) =>
          mods.some((m) => m.includes(frag)) || fileName.includes(frag)
        );

        if (!isCritical) {
          if (output.code.length < minChunkSize) {
            if (hasDebugProtection && output.isEntry) {
              output.code = createAntiDebugTrap(debugInterval) + output.code;
            }
            continue;
          }

          if (include && !matchesPattern(fileName, include) && !mods.some((m) => matchesPattern(m, include))) {
            if (hasDebugProtection && output.isEntry) {
              output.code = createAntiDebugTrap(debugInterval) + output.code;
            }
            continue;
          }

          if (exclude && (matchesPattern(fileName, exclude) || mods.some((m) => matchesPattern(m, exclude)))) {
            if (hasDebugProtection && output.isEntry) {
              output.code = createAntiDebugTrap(debugInterval) + output.code;
            }
            continue;
          }

          if (!obfuscateEntry && output.isEntry) {
            if (hasDebugProtection) {
              output.code = createAntiDebugTrap(debugInterval) + output.code;
            }
            continue;
          }

          if (autoExcludeNodeModules) {
            const isVendorName = /[\\/](vendor|node_modules)[\\/]/i.test(fileName)
              || fileName.includes("vendor-")
              || fileName.includes("-vendor")
              || fileName.includes(".vendor.");
            const allModulesVendor = mods.length > 0 && mods.every((m) => m.includes("/node_modules/"));

            if (isVendorName || allModulesVendor) {
              continue;
            }
          }
        }

        if (hasDebugProtection && output.isEntry) {
          output.code = createAntiDebugTrap(debugInterval) + output.code;
        }

        tasks.push({ fileName, output });
      }

      if (tasks.length === 0) return;

      const t0 = performance.now();
      const taskMap = new Map();
      tasks.forEach((t) => taskMap.set(t.fileName, t));

      if (workers.length > 1) {
        await Promise.all(readyPromises);

        let taskIdx = 0;
        let completed = 0;
        let successful = 0;

        await new Promise((resolve) => {
          let isResolved = false;

          const dispatch = (worker) => {
            if (isResolved) return;
            if (taskIdx >= tasks.length) {
              if (completed >= tasks.length && !isResolved) {
                isResolved = true;
                resolve();
              }
              return;
            }

            const task = tasks[taskIdx++];
            worker.postMessage({
              id: task.fileName,
              code: task.output.code,
              options: Object.assign({}, obfOptions, { inputFileName: task.fileName })
            });
          };

          workers.forEach((w) => {
            const onMsg = (msg) => {
              if (!msg || msg.type === "ready") return;
              const target = taskMap.get(msg.id);
              if (target) {
                if (msg.success && msg.code) {
                  target.output.code = msg.code;
                  if (msg.map && target.output.map) {
                    try { target.output.map = JSON.parse(msg.map); } catch (_) {}
                  }
                  successful++;
                } else if (msg.error && verbose) {
                  console.warn(`\x1b[33m!\x1b[0m [magnon] Obfuscation warning for ${msg.id}: ${msg.error}`);
                }
              }
              completed++;
              dispatch(w);
            };

            const onErr = (err) => {
              if (verbose) {
                console.warn(`\x1b[33m!\x1b[0m [magnon] Worker thread error: ${err?.message || err}`);
              }
              completed++;
              dispatch(w);
            };

            w.on("message", onMsg);
            w.on("error", onErr);
            dispatch(w);
          });
        });

        const dt = performance.now() - t0;
        if (verbose) {
          console.log(`\x1b[32m✓\x1b[0m [magnon] Parallel obfuscated ${successful}/${tasks.length} chunks across ${workers.length} workers in ${dt.toFixed(1)}ms`);
        }
      } else {
        const JavaScriptObfuscator = require(resolved);
        let successful = 0;

        for (const task of tasks) {
          try {
            const res = JavaScriptObfuscator.obfuscate(
              task.output.code,
              Object.assign({}, obfOptions, { inputFileName: task.fileName })
            );
            task.output.code = res.getObfuscatedCode();
            if (obfOptions.sourceMap && task.output.map) {
              const sm = res.getSourceMap();
              if (sm) {
                try { task.output.map = JSON.parse(sm); } catch (_) {}
              }
            }
            successful++;
          } catch (err) {
            if (verbose) {
              console.warn(`\x1b[33m!\x1b[0m [magnon] Obfuscation failed for ${task.fileName}: ${err.message}`);
            }
          }
        }

        const dt = performance.now() - t0;
        if (verbose) {
          console.log(`\x1b[32m✓\x1b[0m [magnon] Obfuscated ${successful}/${tasks.length} chunks in ${dt.toFixed(1)}ms`);
        }
      }
    },

    closeBundle() {
      workers.forEach((w) => {
        try { w.terminate(); } catch (_) {}
      });
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
        build: {
          rolldownOptions: {
            onwarn(warning, defaultHandler) {
              if (warning.code === "MODULE_LEVEL_DIRECTIVE") return;
              defaultHandler(warning);
            }
          }
        }
      };

      const injectedAliases = [];
      if (Array.isArray(options.esmAliases)) {
        for (const pkg of options.esmAliases) {
          injectedAliases.push(
            { find: new RegExp(`^${pkg}/(?!esm/)(.*)`), replacement: `${pkg}/esm/$1` },
            { find: new RegExp(`^${pkg}$`), replacement: `${pkg}/esm` }
          );
        }
      }
      if (Array.isArray(options.alias)) {
        injectedAliases.push(...options.alias);
      } else if (options.alias && typeof options.alias === "object") {
        Object.entries(options.alias).forEach(([find, replacement]) => {
          injectedAliases.push({ find, replacement });
        });
      }

      if (injectedAliases.length > 0) {
        cfg.resolve = { alias: injectedAliases };
      }

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
          cache.set(path.normalize(item.path), {
            code: item.outputCode,
            map: item.map ? JSON.parse(item.map) : null,
          });
        }
      }
    },

    transform(code, id) {
      const cleanId = path.normalize(id.split("?")[0]);
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
