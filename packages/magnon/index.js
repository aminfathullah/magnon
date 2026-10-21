const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
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
  getDefaultPackageImportPresets,
} = nativeAddon;

const DEFAULT_OPTIMIZE_IMPORTS = typeof getDefaultPackageImportPresets === "function"
  ? getDefaultPackageImportPresets()
  : [];

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
        gzipLevel: options.gzipLevel ? Math.min(options.gzipLevel, 5) : 5,
        brotliQuality: options.brotliQuality ? Math.min(options.brotliQuality, 3) : 3,
        threshold: Math.max(options.threshold ?? 1024, 1536),
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

function createFrameworkPreset(packages, priority = 50, name = "core-vendor") {
  const escaped = packages.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  return {
    name,
    priority,
    test: new RegExp(`[\\\\/]node_modules[\\\\/](${escaped})[\\\\/]`),
    packages: packages.map((p) => `/${p}/`),
  };
}

const FRAMEWORK_PRESETS = {
  react: createFrameworkPreset([
    "react", "react-dom", "scheduler", "prop-types",
    "use-sync-external-store", "hoist-non-react-statics", "react-is"
  ]),
  vue: createFrameworkPreset([
    "vue", "@vue/runtime-core", "@vue/runtime-dom", "@vue/reactivity", "@vue/shared"
  ]),
  svelte: createFrameworkPreset(["svelte"]),
  preact: createFrameworkPreset(["preact"]),
  solid: createFrameworkPreset(["solid-js"]),
};

function codeSplitting(options = {}) {
  let framework = options.framework;
  if (!framework && options.framework !== false) {
    framework = "react";
  }

  const customGroups = options.groups || [];
  const defaultVendors = framework ? {
    "data-vendor": {
      test: /\.json$/i,
      priority: 25
    }
  } : {};
  const chunks = Object.assign({}, defaultVendors, options.chunks || (options.vendors ? options.vendors : {}));
  if (!options.chunks && !options.vendors && !options.groups && !options.framework) {
    Object.entries(options).forEach(([k, v]) => {
      if (k !== "framework" && k !== "groups" && k !== "chunks" && k !== "vendors" && k !== "priority" && k !== "frameworkChunkName") {
        chunks[k] = v;
      }
    });
  }

  const rolldownGroups = [];
  const frameworkName = options.frameworkChunkName || (framework && FRAMEWORK_PRESETS[framework] ? FRAMEWORK_PRESETS[framework].name : "core-vendor");

  if (framework && FRAMEWORK_PRESETS[framework]) {
    rolldownGroups.push({
      name: frameworkName,
      test: FRAMEWORK_PRESETS[framework].test,
      priority: FRAMEWORK_PRESETS[framework].priority
    });
  }

  const chunkEntries = Object.entries(chunks);
  chunkEntries.forEach(([chunkName, chunkDef], index) => {
    let testPattern;
    let chunkPriority = Math.max(10, 40 - index * 5);
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
  const res = {
    groups: rolldownGroups,
  };
  Object.defineProperty(res, "manualChunks", {
    value: manualChunksFn,
    enumerable: false,
    configurable: true,
    writable: true,
  });
  return res;
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

function patchRolldownCjsInteropCode(code) {
  if (typeof code !== "string" || code.length < 50) return code;
  if (code.indexOf(".__esModule") === -1 || code.indexOf("__esModule|") === -1) return code;
  if (!code.includes("default") || !code.includes(".call(")) return code;
  return code.replace(
    /(?:[a-zA-Z0-9_$]+\s*\|\|\s*)?!([a-zA-Z0-9_$]+)\s*\|\|\s*!\1\.__esModule\s*\|\|\s*!([a-zA-Z0-9_$]+)\.call\(\1,\s*(["'`])default\3\)/g,
    "(!$1||!$2.call($1,$3default$3))"
  );
}

function fixRolldownCjsInterop(bundle) {
  if (!bundle || typeof bundle !== "object") return;
  for (const chunk of Object.values(bundle)) {
    if (!chunk || chunk.type !== "chunk") continue;
    if (typeof chunk.code !== "string" || chunk.code.length < 50) continue;
    if (!chunk.code.includes(".__esModule") || !chunk.code.includes(".call(")) continue;
    chunk.code = patchRolldownCjsInteropCode(chunk.code);
  }
}

function createAntiDebugTrap(options = {}) {
  const config = typeof options === "number" ? { interval: options } : options;
  const interval = Math.max(1000, config.interval || 2000);
  const maxDepth = config.maxDepth || 20;
  const dimensionThreshold = config.dimensionThreshold || 160;
  const timeThreshold = config.timeThreshold || 150;
  const checkDockInterval = Math.max(1000, Math.floor(interval / 2));

  return `(function(){if(typeof window==="undefined")return;var _g=typeof window!=="undefined"?window:(typeof globalThis!=="undefined"?globalThis:self);if(!_g||!_g.document)return;function _trap(c){if(typeof c!=="number")c=0;if(c>${maxDepth})return;try{(function(){return!0;}["constructor"]("debu"+"gger")["call"]("action"));}catch(_){}_trap(c+1);}function _check(){var t=Date.now();(function(){return!0;}["constructor"]("debu"+"gger")["call"]("action"));if(Date.now()-t>${timeThreshold}){try{console.clear();}catch(_){}_trap(0);}}function _checkDock(){try{var wd=_g.outerWidth-_g.innerWidth,hd=_g.outerHeight-_g.innerHeight;if(wd>${dimensionThreshold}||hd>${dimensionThreshold}){try{console.clear();}catch(_){}_trap(0);}}catch(_){}}try{_check();_checkDock();setInterval(_check,${interval});setInterval(_checkDock,${checkDockInterval});_g.addEventListener("resize",_checkDock,{passive:true});_g.addEventListener("focus",_check,{passive:true});_g.addEventListener("keydown",function(e){if(e.key==="F12"||((e.ctrlKey||e.metaKey)&&e.shiftKey&&(e.key==="I"||e.key==="i"||e.key==="J"||e.key==="j"||e.key==="C"||e.key==="c"))||((e.ctrlKey||e.metaKey)&&(e.key==="U"||e.key==="u"))||((e.ctrlKey||e.metaKey)&&(e.key==="S"||e.key==="s"))){try{e.preventDefault();e.stopPropagation();}catch(_){}_trap(0);}},true);}catch(_){}})();\n`;
}

function obfuscator(pluginOptions = {}) {
  const {
    enable = true,
    include,
    exclude,
    autoExcludeNodeModules = true,
    obfuscateEntry = false,
    criticalModuleFragments: criticalFragments = [],
    criticalFragments: altCriticalFragments = [],
    minChunkSize = 0,
    threads,
    verbose = true,
    options = {},
    debugProtection,
    debugProtectionInterval,
    ...restPluginOptions
  } = pluginOptions;
  const mergedCriticalFragments = criticalFragments.length > 0 ? criticalFragments : altCriticalFragments;

  if (!enable) {
    return { name: "vite-plugin-magnon-obfuscator" };
  }

  const workerCount = threads || Math.min(os.cpus()?.length || 4, 8);
  const obfOptions = { ...restPluginOptions, ...options };
  const hasDebugProtection = Boolean(
    options.debugProtection ?? debugProtection ?? obfOptions.debugProtection
  );
  const rawInterval = options.debugProtectionInterval ?? debugProtectionInterval ?? obfOptions.debugProtectionInterval;
  const debugInterval = (typeof rawInterval === "number" && rawInterval > 0) ? Math.floor(rawInterval) : 2000;

  delete obfOptions.debugProtection;
  delete obfOptions.debugProtectionInterval;

  const userReserved = Array.isArray(obfOptions.reservedNames) ? obfOptions.reservedNames : [];
  const defaultReserved = ["default", "__esModule"];
  obfOptions.reservedNames = Array.from(new Set([...defaultReserved, ...userReserved]));

  if (obfOptions.sourceMap === undefined) {
    obfOptions.sourceMap = false;
  }

  const userReservedStrings = Array.isArray(obfOptions.reservedStrings) ? obfOptions.reservedStrings : [];
  obfOptions.reservedStrings = userReservedStrings;

  if (obfOptions.simplify === undefined) {
    obfOptions.simplify = false;
  }
  if (obfOptions.unicodeEscapeSequence === undefined) {
    obfOptions.unicodeEscapeSequence = false;
  }
  if (obfOptions.selfDefending === undefined) {
    obfOptions.selfDefending = false;
  }
  if (obfOptions.numbersToExpressions === undefined) {
    obfOptions.numbersToExpressions = false;
  }
  if (obfOptions.ignoreImports === undefined) {
    obfOptions.ignoreImports = true;
  }
  if (!obfOptions.target) {
    obfOptions.target = "browser";
  }
  if (obfOptions.stringArrayWrappersCount === undefined) {
    obfOptions.stringArrayWrappersCount = 1;
  }
  if (obfOptions.stringArrayWrappersChainedCalls === undefined) {
    obfOptions.stringArrayWrappersChainedCalls = false;
  }
  if (obfOptions.stringArrayCallsTransform === undefined) {
    obfOptions.stringArrayCallsTransform = false;
  }
  if (obfOptions.stringArrayCallsTransformThreshold === undefined) {
    obfOptions.stringArrayCallsTransformThreshold = 0;
  }
  if (obfOptions.splitStrings === undefined) {
    obfOptions.splitStrings = false;
  }
  if (obfOptions.transformObjectKeys === undefined) {
    obfOptions.transformObjectKeys = false;
  }
  if (!obfOptions.identifierNamesGenerator) {
    obfOptions.identifierNamesGenerator = "mangled";
  }
  if (obfOptions.seed === undefined) {
    obfOptions.seed = 12345;
  }
  if (obfOptions.disableConsoleOutput === undefined) {
    obfOptions.disableConsoleOutput = false;
  }
  if (obfOptions.stringArrayThreshold === undefined) {
    obfOptions.stringArrayThreshold = 0;
  }
  if (obfOptions.stringArrayThreshold === 0) {
    obfOptions.stringArray = false;
  }
  if (obfOptions.renameGlobals === undefined) {
    obfOptions.renameGlobals = false;
  }
  if (obfOptions.renameProperties === undefined) {
    obfOptions.renameProperties = false;
  }
  if (obfOptions.stringArrayRotate === undefined) {
    obfOptions.stringArrayRotate = false;
  }
  if (obfOptions.stringArrayShuffle === undefined) {
    obfOptions.stringArrayShuffle = false;
  }
  if (obfOptions.stringArrayIndexShift === undefined) {
    obfOptions.stringArrayIndexShift = false;
  }
  if (obfOptions.controlFlowFlattening === undefined) {
    obfOptions.controlFlowFlattening = false;
  }
  if (obfOptions.deadCodeInjection === undefined) {
    obfOptions.deadCodeInjection = false;
  }

  let workers = [];
  const readyPromises = [];
  let pkgPath = null;
  let hasResolvedPkg = false;

  const workerScript = `
    const { parentPort, workerData } = require("worker_threads");
    const JavaScriptObfuscator = require(workerData.pkgPath);
    const baseOptions = workerData.defaultOptions || {};
    try {
      const warmup = Array(12).fill(0).map((_, i) => "export function _w" + i + "(a, b) { var x = { id: " + i + ", v: a + b }; switch(a) { case 1: return x.v * 2; default: return [x, { ...x }]; } }").join("\\n");
      JavaScriptObfuscator.obfuscate(warmup, baseOptions);
    } catch (_) {}
    parentPort.postMessage({ type: "ready" });

    parentPort.on("message", ({ id, code, inputFileName }) => {
      try {
        const t0 = performance.now();
        const res = JavaScriptObfuscator.obfuscate(code, Object.assign({}, baseOptions, { inputFileName }));
        const obfTime = performance.now() - t0;
        parentPort.postMessage({
          id,
          success: true,
          code: res.getObfuscatedCode(),
          map: baseOptions.sourceMap ? res.getSourceMap() : null,
          obfTime
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

  let workersInitialized = false;
  function initWorkers() {
    if (workersInitialized) return;
    workersInitialized = true;
    const resolved = resolvePackage();
    if (!resolved) {
      if (verbose) {
        console.warn("\x1b[33m!\x1b[0m [magnon] 'javascript-obfuscator' package not found. Skipping obfuscation. (Install it via 'pnpm add -D javascript-obfuscator')");
      }
      return;
    }

    const prewarmCount = mergedCriticalFragments.length > 0
      ? Math.min(workerCount, mergedCriticalFragments.length)
      : Math.min(workerCount, 4);

    if (prewarmCount > 1) {
      for (let i = 0; i < prewarmCount; i++) {
        try {
          const w = new Worker(workerScript, { eval: true, workerData: { pkgPath: resolved, defaultOptions: obfOptions } });
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
  }

  let nextWorkerIdx = 0;
  async function obfuscateWithWorker(code, filename) {
    initWorkers();
    const resolved = resolvePackage();
    if (!resolved) return { code };

    if (workers.length > 0) {
      const wIdx = nextWorkerIdx++ % workers.length;
      const worker = workers[wIdx];
      await readyPromises[wIdx];
      return new Promise((resolve) => {
        const onMsg = (msg) => {
          if (msg && msg.id === filename) {
            worker.off("message", onMsg);
            worker.off("error", onErr);
            resolve(msg.success && msg.code ? { code: msg.code, map: msg.map } : { code });
          }
        };
        const onErr = () => {
          worker.off("message", onMsg);
          worker.off("error", onErr);
          resolve({ code });
        };
        worker.on("message", onMsg);
        worker.on("error", onErr);
        worker.postMessage({ id: filename, code, inputFileName: filename });
      });
    }

    const JavaScriptObfuscator = require(resolved);
    try {
      const res = JavaScriptObfuscator.obfuscate(code, Object.assign({}, obfOptions, { inputFileName: filename }));
      return { code: res.getObfuscatedCode(), map: obfOptions.sourceMap ? res.getSourceMap() : null };
    } catch (_) {
      return { code };
    }
  }

  const obfuscatedModules = new Set();
  const moduleObfCache = new Map();

  function prewarmCriticalModules(rootDir) {
    if (!mergedCriticalFragments.length) return;
    const srcDir = path.join(rootDir, "src");
    if (!fs.existsSync(srcDir)) return;

    const findMatches = (dir) => {
      const matches = [];
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!entry.name.startsWith(".") && entry.name !== "node_modules") {
            matches.push(...findMatches(full));
          }
        } else if (/\.[jt]sx?$/.test(entry.name)) {
          const norm = full.split(path.sep).join("/");
          if (mergedCriticalFragments.some((frag) => norm.includes(frag))) {
            matches.push(full);
          }
        }
      }
      return matches;
    };

    const targetFiles = findMatches(srcDir);
    for (const file of targetFiles) {
      const norm = file.split(path.sep).join("/");
      (async () => {
        try {
          const raw = fs.readFileSync(file, "utf8");
          const transformed = transform(raw, file, { jsxRuntime: "automatic", development: false });
          const code = transformed && transformed.code ? transformed.code : raw;
          const res = await obfuscateWithWorker(code, norm);
          moduleObfCache.set(norm, res);
          obfuscatedModules.add(norm);
        } catch (_) {}
      })();
    }
  }

  return {
    name: "vite-plugin-magnon-obfuscator",
    apply: "build",
    enforce: "post",

    configResolved(config) {
      initWorkers();
      const root = config?.root ? path.resolve(config.root) : process.cwd();
      prewarmCriticalModules(root);
    },

    buildStart() {
      initWorkers();
    },

    transform: {
      filter: { id: /\.[jt]sx?$/ },
      async handler(code, id) {
        if (!mergedCriticalFragments.length || id.includes("node_modules")) return null;
        const norm = id.split(path.sep).join("/");
        const isCritical = mergedCriticalFragments.some((frag) => norm.includes(frag));
        if (!isCritical) return null;

        if (moduleObfCache.has(norm)) {
          const cached = moduleObfCache.get(norm);
          return { code: cached.code, map: cached.map || null };
        }

        const t0 = performance.now();
        const res = await obfuscateWithWorker(code, norm);
        obfuscatedModules.add(norm);
        if (verbose) {
          const dt = performance.now() - t0;
          console.log(`  \x1b[32m✓\x1b[0m [magnon] Module ${path.basename(norm)} (${(code.length / 1024).toFixed(1)} kB) obfuscated in ${dt.toFixed(1)}ms`);
        }
        return { code: res.code, map: res.map || null };
      }
    },

    async generateBundle(outputOptions, bundle) {
      const resolved = resolvePackage();
      if (!resolved && !hasDebugProtection) return;

      const trap = hasDebugProtection ? createAntiDebugTrap(debugInterval) : "";
      if (trap) {
        for (const output of Object.values(bundle)) {
          if (output && output.type === "chunk" && output.isEntry && typeof output.code === "string") {
            if (!output.code.includes("debu\"+\"gger") && !output.code.includes("debugger")) {
              output.code = trap + output.code;
            }
          }
        }
      }

      const tasks = [];
      const normalize = (id) => id.split(path.sep).join("/");

      for (const [fileName, output] of Object.entries(bundle)) {
        if (!output || output.type !== "chunk" || typeof output.code !== "string") {
          continue;
        }

        const mods = Object.keys(output.modules || {}).map(normalize);
        const hasUnobfuscatedCritical = mergedCriticalFragments.length > 0 && mods.some((m) =>
          mergedCriticalFragments.some((frag) => m.includes(frag)) && !obfuscatedModules.has(m)
        );

        if (exclude && (matchesPattern(fileName, exclude) || mods.some((m) => matchesPattern(m, exclude)))) {
          continue;
        }

        const isVendorChunk = /[\\/](vendor|node_modules)[\\/]/i.test(fileName)
          || /(?:^|[._/-])vendor(?:[._/-]|$)/i.test(fileName);
        const allModulesVendor = mods.length > 0 && mods.every((m) => m.includes("/node_modules/"));

        if (hasUnobfuscatedCritical) {
          if (!isVendorChunk && !allModulesVendor) {
            tasks.push({ fileName, output });
          }
          continue;
        }

        if (mergedCriticalFragments.length > 0 && !include) {
          continue;
        }

        if (autoExcludeNodeModules && (isVendorChunk || allModulesVendor)) {
          continue;
        }

        if (!obfuscateEntry && output.isEntry) {
          continue;
        }

        if (output.code.length < minChunkSize) {
          continue;
        }

        if (include && !matchesPattern(fileName, include) && !mods.some((m) => matchesPattern(m, include))) {
          continue;
        }

        tasks.push({ fileName, output });
      }

      if (!resolved || tasks.length === 0) return;

      tasks.sort((a, b) => b.output.code.length - a.output.code.length);

      const t0 = performance.now();
      const taskMap = new Map();
      tasks.forEach((t) => taskMap.set(t.fileName, t));

      const activeWorkers = workers.slice(0, Math.min(workers.length, tasks.length));

      if (activeWorkers.length > 1) {
        await Promise.all(readyPromises.slice(0, activeWorkers.length));

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
            task.t0 = performance.now();
            worker.postMessage({
              id: task.fileName,
              code: task.output.code,
              inputFileName: task.fileName
            });
          };

          activeWorkers.forEach((w) => {
            const onMsg = (msg) => {
              if (!msg || msg.type === "ready") return;
              const target = taskMap.get(msg.id);
              if (target) {
                const chunkDt = msg.obfTime !== undefined ? msg.obfTime : (performance.now() - target.t0);
                if (verbose) {
                  console.log(`  [magnon] Chunk ${msg.id} (${(target.output.code.length / 1024).toFixed(1)} kB) obfuscated in ${chunkDt.toFixed(1)}ms`);
                }
                if (msg.success && msg.code) {
                  target.output.code = (trap && target.output.isEntry && !msg.code.includes('debu"+"gger')) ? trap + msg.code : msg.code;
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
          console.log(`\x1b[32m✓\x1b[0m [magnon] Parallel obfuscated ${successful}/${tasks.length} chunks across ${activeWorkers.length} workers in ${dt.toFixed(1)}ms`);
        }
        return;
      }

      const JavaScriptObfuscator = require(resolved);
      let successful = 0;

        for (const task of tasks) {
          try {
            const res = JavaScriptObfuscator.obfuscate(
              task.output.code,
              Object.assign({}, obfOptions, { inputFileName: task.fileName })
            );
            const obfCode = res.getObfuscatedCode();
            task.output.code = (trap && task.output.isEntry && !obfCode.includes('debu"+"gger')) ? trap + obfCode : obfCode;
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
    },

    closeBundle() {
      workers.forEach((w) => {
        try { w.terminate(); } catch (_) {}
      });
      workers = [];
      readyPromises.length = 0;
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
        : DEFAULT_OPTIMIZE_IMPORTS);
  const modularizeImports = options.modularizeImports || {};
  const cache = new Map();
  const icssResolvedCache = new Map();
  let resolvedConfig;
  let prewarmPromise = null;

  return {
    name: "vite-plugin-magnon",
    enforce: "pre",

    config(config) {
      const rootDir = config?.root ? path.resolve(config.root) : process.cwd();
      const nodeModulesPath = path.join(rootDir, "node_modules");
      const srcPath = path.join(rootDir, "src");
      const userScss = config?.css?.preprocessorOptions?.scss || {};
      const userLoadPaths = Array.isArray(userScss.loadPaths) ? userScss.loadPaths : [];

      const cfg = {
        esbuild: false,
        oxc: false,
        css: {
          transformer: config?.css?.transformer ?? "lightningcss",
          preprocessorMaxWorkers: config?.css?.preprocessorMaxWorkers ?? Math.min(os.cpus()?.length || 4, 8),
          preprocessorOptions: {
            scss: {
              ...userScss,
              loadPaths: Array.from(new Set([...userLoadPaths, nodeModulesPath, srcPath]))
            }
          }
        },
        build: {
          chunkSizeWarningLimit: 6000,
          rolldownOptions: {
            onwarn(warning, defaultHandler) {
              if (warning.code === "MODULE_LEVEL_DIRECTIVE" || warning.code === "EVAL" || warning.code === "INEFFECTIVE_DYNAMIC_IMPORT" || String(warning.code || "").includes("EVAL")) return;
              defaultHandler(warning);
            },
            output: {
              comments: false
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
      if (!prewarm) return;
      const root = resolvedConfig?.root || process.cwd();
      const srcDir = path.join(root, "src");
      if (!fs.existsSync(srcDir)) return;

      prewarmPromise = (async () => {
        try {
          const preloads = [
            import("sass-embedded").catch(() => {}),
            import("postcss").catch(() => {})
          ];
          Promise.all(preloads).catch(() => {});
        } catch (_) {}

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
              map: item.map ? JSON.parse(item.map) : null,
            });
          }
        }
      })();
    },

    async buildStart() {
      if (prewarmPromise) {
        await prewarmPromise;
      }
    },

    resolveId: {
      filter: { id: /\.module\.(scss|sass|less|css)/i },
      async handler(source, importer) {
        if (typeof source !== "string" || !source.includes(".module.")) return null;
        if (!/\.module\.(scss|sass|less|css)(\?.*)?$/i.test(source)) return null;
        const cleanSource = source.split("?")[0];
        const cacheKey = importer ? `${importer}::${cleanSource}` : cleanSource;
        if (icssResolvedCache.has(cacheKey)) {
          return icssResolvedCache.get(cacheKey);
        }
        const resolved = await this.resolve(cleanSource, importer, { skipSelf: true });
        if (!resolved || resolved.external || !resolved.id) {
          icssResolvedCache.set(cacheKey, null);
          return null;
        }
        if (icssResolvedCache.has(resolved.id)) {
          const res = icssResolvedCache.get(resolved.id);
          icssResolvedCache.set(cacheKey, res);
          return res;
        }
        let res = null;
        try {
          if (fs.existsSync(resolved.id)) {
            const raw = fs.readFileSync(resolved.id, "utf8");
            if (raw.includes(":export")) {
              res = "\0magnon-icss:" + resolved.id + ".js";
            }
          }
        } catch (_) {}
        icssResolvedCache.set(resolved.id, res);
        icssResolvedCache.set(cacheKey, res);
        return res;
      }
    },

    load: {
      filter: { id: /(^\0magnon-icss:|\?magnon-css-direct)/ },
      handler(id) {
        if (id.startsWith("\0magnon-icss:")) {
          const realPath = id.slice("\0magnon-icss:".length).replace(/\.js$/, "");
          this.addWatchFile(realPath);
          const raw = fs.readFileSync(realPath, "utf8");
          let css = raw;

          const scssVars = new Map();
          for (const line of raw.split("\n")) {
            const trimmed = line.trim();
            if (trimmed.startsWith("$")) {
              const idx = trimmed.indexOf(":");
              if (idx !== -1) {
                const name = trimmed.slice(1, idx).trim();
                let val = trimmed.slice(idx + 1).replace(/;.*$/, "").replace(/\/\/.*$/, "").trim();
                while (val.startsWith("$") && scssVars.has(val.slice(1))) {
                  val = scssVars.get(val.slice(1));
                }
                scssVars.set(name, val);
              }
            }
          }

          try {
            const rootDir = resolvedConfig?.root || process.cwd();
            const req = require("module").createRequire(realPath);
            const sass = req("sass") || require("module").createRequire(rootDir)("sass");
            const compileString = sass.compileString || sass.default?.compileString;
            if (compileString) {
              css = compileString(raw, {
                loadPaths: [path.dirname(realPath), path.join(rootDir, "src"), path.join(rootDir, "node_modules")]
              }).css;
            }
          } catch (_) {}

          const exportMatch = css.match(/:export\s*\{([\s\S]*?)\}/);
          const exportsObj = {};
          if (exportMatch) {
            const body = exportMatch[1];
            const declRegex = /([a-zA-Z0-9_-]+)\s*:\s*([^;]+);/g;
            let m;
            while ((m = declRegex.exec(body)) !== null) {
              const k = m[1].trim();
              let v = m[2].trim();
              if (v.startsWith("$") && scssVars.has(v.slice(1))) {
                v = scssVars.get(v.slice(1));
              }
              exportsObj[k] = v;
            }
          }

          const lines = [];
          const nonExportCss = css.replace(/:export\s*\{[\s\S]*?\}/g, "").trim();
          if (nonExportCss.length > 0) {
            lines.push(`import ${JSON.stringify(realPath + "?magnon-css-direct")};`);
          }

          for (const [k, v] of Object.entries(exportsObj)) {
            if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(k)) {
              lines.push(`export const ${k} = ${JSON.stringify(v)};`);
            }
          }
          lines.push(`export default ${JSON.stringify(exportsObj, null, 2)};`);
          return lines.join("\n");
        }

        if (id.includes("?magnon-css-direct")) {
          const realPath = id.split("?")[0];
          this.addWatchFile(realPath);
          const raw = fs.readFileSync(realPath, "utf8");
          return raw.replace(/:export\s*\{[\s\S]*?\}/g, "");
        }
      }
    },

    transform: {
      filter: { id: /^(?!.*node_modules).*\.[jt]sx?$/ },
      handler(code, id) {
        if (id.charCodeAt(0) === 0 || id.includes("node_modules")) {
          return null;
        }
        const qIdx = id.indexOf("?");
        const cleanId = qIdx === -1 ? id : id.slice(0, qIdx);
        if (!filter.test(cleanId)) {
          return null;
        }

        const cached = cache.get(cleanId);
        if (cached !== undefined) {
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
          if (this && typeof this.error === "function") {
            this.error(`[magnon] Transform error in ${cleanId}: ${err.message}`);
          } else {
            throw err;
          }
        }
      }
    },

    renderChunk: {
      filter: { code: /__esModule/ },
      handler(code, chunk) {
        if (!chunk || typeof code !== "string" || code.length < 50) return null;
        if (code.indexOf(".__esModule") === -1 || code.indexOf("__esModule|") === -1) return null;
        const patched = patchRolldownCjsInteropCode(code);
        if (patched !== code) {
          return { code: patched, map: null };
        }
        return null;
      }
    },

    generateBundle(outputOptions, bundle) {
      fixRolldownCjsInterop(bundle);
    },

    closeBundle() {
      const root = resolvedConfig?.root || process.cwd();
      const outDir = path.resolve(root, resolvedConfig?.build?.outDir || "dist");
      if (!fs.existsSync(outDir)) return;

      if (!compressOpts) return;

      const res = compressDirectory(outDir, {
        gzip: compressOpts.gzip !== false,
        brotli: compressOpts.brotli !== false,
        gzipLevel: compressOpts.gzipLevel ?? 5,
        brotliQuality: compressOpts.brotliQuality ? Math.min(compressOpts.brotliQuality, 3) : 3,
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
module.exports.getDefaultPackageImportPresets = getDefaultPackageImportPresets;
module.exports.DEFAULT_OPTIMIZE_IMPORTS = DEFAULT_OPTIMIZE_IMPORTS;
