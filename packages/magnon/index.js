const path = require('path');
const fs = require('fs');

let nativeAddon;
try {
  nativeAddon = require('./magnon.node');
} catch (e) {
  try {
    nativeAddon = require(path.join(__dirname, '../../target/release/magnon.node'));
  } catch (err) {
    throw new Error('Failed to load native Magnon binary: ' + err.message);
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
    name: 'vite-plugin-magnon-compression',
    apply: 'build',
    enforce: 'post',
    configResolved(config) {
      resolvedConfig = config;
    },
    closeBundle() {
      const root = resolvedConfig?.root || process.cwd();
      const outDir = path.resolve(root, resolvedConfig?.build?.outDir || 'dist');
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

function magnonPlugin(options = {}) {
  const filter = options.include || /\.[jt]sx?$/;
  const exclude = options.exclude || /node_modules/;
  const prewarm = options.prewarm !== false;
  const compressOpts = options.compress === true ? {} : options.compress;
  const cache = new Map();
  let resolvedConfig;

  return {
    name: 'vite-plugin-magnon',
    enforce: 'pre',

    config(config) {
      return {
        esbuild: false,
      };
    },

    configResolved(config) {
      resolvedConfig = config;
    },

    buildStart() {
      if (!prewarm) return;
      const root = resolvedConfig?.root || process.cwd();
      const srcDir = path.join(root, 'src');
      if (!fs.existsSync(srcDir)) return;

      const collect = (dir) => {
        const out = [];
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            if (!entry.name.startsWith('.') && entry.name !== 'node_modules') {
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
        jsxRuntime: options.jsxRuntime || 'automatic',
        development: options.development || false,
        refresh: options.refresh || false,
        sourcemap: options.sourcemap || false,
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
      const cleanId = id.split('?')[0];
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
          jsxRuntime: options.jsxRuntime || 'automatic',
          development: options.development || false,
          refresh: options.refresh || false,
          sourcemap: options.sourcemap || false,
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
      const outDir = path.resolve(root, resolvedConfig?.build?.outDir || 'dist');
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
module.exports.transform = transform;
module.exports.transformBatch = transformBatch;
module.exports.compressGzip = compressGzip;
module.exports.compressBrotli = compressBrotli;
module.exports.compressDirectory = compressDirectory;
module.exports.compressFiles = compressFiles;
