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

const { transform, transformBatch } = nativeAddon;

function magnonPlugin(options = {}) {
  const filter = options.include || /\.[jt]sx?$/;
  const exclude = options.exclude || /node_modules/;
  const prewarm = options.prewarm !== false;
  const cache = new Map();

  return {
    name: 'vite-plugin-magnon',
    enforce: 'pre',

    config(config) {
      return {
        esbuild: false,
      };
    },

    buildStart() {
      if (!prewarm) return;
      const root = process.cwd();
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
  };
}

module.exports = magnonPlugin;
module.exports.default = magnonPlugin;
module.exports.magnon = magnonPlugin;
module.exports.transform = transform;
module.exports.transformBatch = transformBatch;
