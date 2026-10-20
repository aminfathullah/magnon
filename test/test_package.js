const assert = require('assert');
const path = require('path');
const fs = require('fs');
const magnon = require('../packages/magnon');

console.log('Running Magnon package integration tests...\n');

function testSingleTransform() {
  const tsCode = `
    interface Profile {
      id: number;
      username: string;
    }
    export const getProfile = (id: number): Profile => ({ id, username: "dev" });
  `;
  const tsRes = magnon.transform(tsCode, 'profile.ts');
  assert(!tsRes.code.includes('interface Profile'));
  assert(tsRes.code.includes('getProfile'));

  const tsxCode = `
    import React from 'react';
    type Props = { title: string };
    export const Header: React.FC<Props> = ({ title }) => <h1>{title}</h1>;
  `;
  const tsxRes = magnon.transform(tsxCode, 'Header.tsx', { jsxRuntime: 'automatic' });
  assert(tsxRes.code.includes('react/jsx-runtime'));
  assert(tsxRes.code.includes('_jsx'));
  assert(!tsxRes.code.includes('type Props'));

  console.log('  PASS: Single-file transform (TypeScript stripping, JSX automatic runtime)');
}

function testOptimizePackageImports() {
  const code = `
    import { IconUsers, IconSearch as SearchIcon } from '@tabler/icons-react';
    import { Button, Typography, alpha } from '@mui/material';
    export const Component = () => {
      return { IconUsers, SearchIcon, Button, Typography, alpha };
    };
  `;

  const res = magnon.transform(code, 'Component.tsx', {
    optimizePackageImports: ['@tabler/icons-react', '@mui/material'],
  });

  assert(res.code.includes('@tabler/icons-react/dist/esm/icons/IconUsers.mjs'));
  assert(res.code.includes('@tabler/icons-react/dist/esm/icons/IconSearch.mjs'));
  assert(res.code.includes('@mui/material/Button'));
  assert(res.code.includes('@mui/material/Typography'));
  assert(res.code.includes('alpha'));
  assert(res.code.includes('@mui/material'));

  console.log('  PASS: Native package import optimization (Tabler Icons & MUI Material)');
}

function testModularizeImports() {
  const code = `
    import { CustomButton, CustomCard } from 'custom-ui';
    export const x = { CustomButton, CustomCard };
  `;

  const res = magnon.transform(code, 'test.tsx', {
    modularizeImports: {
      'custom-ui': {
        transform: 'custom-ui/dist/components/{{member}}',
      },
    },
  });

  assert(res.code.includes('custom-ui/dist/components/CustomButton'));
  assert(res.code.includes('custom-ui/dist/components/CustomCard'));

  console.log('  PASS: Custom modularize imports with template substitution');
}

function testSplitChunks() {
  const splitHelper = magnon.splitChunks({
    framework: false,
    chunks: {
      'igniteui-vendor': ['igniteui-react'],
      'swagger-vendor': ['swagger-ui', 'swagger-client'],
    }
  });

  assert.strictEqual(splitHelper('/project/node_modules/igniteui-react-grids/index.js'), 'igniteui-vendor');
  assert.strictEqual(splitHelper('/project/node_modules/swagger-ui-react/index.js'), 'swagger-vendor');
  assert.strictEqual(splitHelper('/project/node_modules/other-pkg/index.js'), undefined);
  assert.strictEqual(splitHelper('/project/src/App.tsx'), undefined);
  assert(Array.isArray(splitHelper.groups));
  assert.strictEqual(splitHelper.groups.length, 2);

  console.log('  PASS: Dual code splitting helper (Rolldown groups & Rollup manualChunks)');
}

function testCodeSplittingPresets() {
  const reactSplit = magnon.codeSplitting({
    framework: 'react',
    chunks: {
      'ag-grid-vendor': ['ag-grid']
    }
  });

  assert(Array.isArray(reactSplit.groups));
  const coreGroup = reactSplit.groups.find(g => g.name === 'core-vendor');
  assert(coreGroup);
  assert.strictEqual(coreGroup.priority, 50);

  const agGroup = reactSplit.groups.find(g => g.name === 'ag-grid-vendor');
  assert(agGroup);

  assert.strictEqual(reactSplit.manualChunks('/project/node_modules/react/index.js'), 'core-vendor');
  assert.strictEqual(reactSplit.manualChunks('/project/node_modules/ag-grid-react/index.js'), 'ag-grid-vendor');

  const vueSplit = magnon.splitChunks({ framework: 'vue' });
  assert.strictEqual(vueSplit('/project/node_modules/vue/dist/vue.esm.js'), 'core-vendor');

  console.log('  PASS: Framework presets for code splitting (React and Vue)');
}

function testExtendedLibraryModularization() {
  const lucideCode = `
    import { ArrowRight, UserCheck } from 'lucide-react';
    export const icons = [ArrowRight, UserCheck];
  `;
  const lucideRes = magnon.transform(lucideCode, 'icons.tsx', {
    optimizePackageImports: ['lucide-react']
  });
  assert(lucideRes.code.includes('lucide-react/dist/esm/icons/arrow-right'));
  assert(lucideRes.code.includes('lucide-react/dist/esm/icons/user-check'));

  const muiIconsCode = `
    import { Visibility, Search } from '@mui/icons-material';
    export const icons = [Visibility, Search];
  `;
  const muiIconsRes = magnon.transform(muiIconsCode, 'muiIcons.tsx', {
    optimizePackageImports: ['@mui/icons-material']
  });
  assert(muiIconsRes.code.includes('@mui/icons-material/esm/Visibility'));
  assert(muiIconsRes.code.includes('@mui/icons-material/esm/Search'));

  console.log('  PASS: Extended modularization (lucide-react kebabCase and @mui/icons-material esm)');
}

function testBatchTransform() {
  const sampleFiles = [
    path.join(__dirname, 'fixtures/App.tsx'),
    path.join(__dirname, 'fixtures/api.ts'),
    path.join(__dirname, 'fixtures/config.ts'),
  ];

  const batchRes = magnon.transformBatch(sampleFiles, { jsxRuntime: 'automatic' });
  assert.strictEqual(batchRes.totalFiles, 3);
  assert.strictEqual(batchRes.successfulFiles, 3);
  assert.strictEqual(batchRes.failedFiles, 0);
  assert(batchRes.wallTimeMs > 0);
  assert(batchRes.totalBytes > 0);

  for (const f of batchRes.files) {
    assert(f.success);
    assert(f.outputCode && f.outputCode.length > 0);
  }

  console.log('  PASS: Batch transform (Multi-file zero-copy memory mapping)');
}

async function testVitePluginHooks() {
  const plugin = magnon({ jsxRuntime: 'automatic', compress: true });
  assert.strictEqual(plugin.name, 'vite-plugin-magnon');
  assert.strictEqual(plugin.enforce, 'pre');
  assert(typeof plugin.transform === 'function' || typeof plugin.transform === 'object');
  assert.strictEqual(typeof plugin.buildStart, 'function');
  assert.strictEqual(typeof plugin.closeBundle, 'function');

  const transformHandler = typeof plugin.transform === 'function' ? plugin.transform : plugin.transform.handler;
  const resolveIdHandler = typeof plugin.resolveId === 'function' ? plugin.resolveId : plugin.resolveId.handler;
  const loadHandler = typeof plugin.load === 'function' ? plugin.load : plugin.load.handler;

  const sampleId = '/virtual/Component.tsx';
  const sampleCode = `
    import { IconUsers } from '@tabler/icons-react';
    export const Component = () => <div>{IconUsers}</div>;
  `;
  const res = transformHandler(sampleCode, sampleId);
  assert(res && res.code);
  assert(res.code.includes('react/jsx-runtime'));
  assert(res.code.includes('@tabler/icons-react/dist/esm/icons/IconUsers.mjs'));

  const ignoredId = '/virtual/node_modules/dep/index.js';
  const ignoredRes = transformHandler('const a = 1;', ignoredId);
  assert.strictEqual(ignoredRes, null);

  const cleanPlugin = magnon({});
  const cleanCfg = cleanPlugin.config({});
  assert(!cleanCfg.resolve || !cleanCfg.resolve.alias);

  const aliasedPlugin = magnon({ esmAliases: ['@mui/icons-material'] });
  const aliasedCfg = aliasedPlugin.config({});
  assert(aliasedCfg.resolve && Array.isArray(aliasedCfg.resolve.alias));
  assert(aliasedCfg.resolve.alias.some(a => a.replacement === '@mui/icons-material/esm'));

  const tmpScss = path.join(__dirname, 'fixtures/temp.module.scss');
  fs.writeFileSync(tmpScss, '$primaryMain: #2196f3;\n:export {\n  primaryMain: $primaryMain;\n}\n');
  try {
    const fakeContext = {
      resolve: async () => ({ id: tmpScss }),
      addWatchFile: () => {}
    };
    const resolvedId = await resolveIdHandler.call(fakeContext, 'temp.module.scss');
    assert(resolvedId && resolvedId.startsWith('\0magnon-icss:'));
    const loaded = loadHandler.call(fakeContext, resolvedId);
    assert(loaded && loaded.includes('export const primaryMain = "#2196f3";'));
    assert(loaded.includes('"primaryMain": "#2196f3"'));
  } finally {
    try { fs.unlinkSync(tmpScss); } catch (_) {}
  }

  console.log('  PASS: Vite plugin lifecycle hooks, ICSS :export resolution, and compression integration');
}

async function testObfuscatorPlugin() {
  const obfDisabled = magnon.obfuscator({ enable: false });
  assert.strictEqual(obfDisabled.name, "vite-plugin-magnon-obfuscator");
  assert.strictEqual(obfDisabled.buildStart, undefined);

  const obf = magnon.obfuscator({
    enable: true,
    minChunkSize: 10,
    debugProtection: true,
    debugProtectionInterval: true,
    obfuscateEntry: true,
    criticalModuleFragments: ["secret-module"],
  });
  assert.strictEqual(obf.name, "vite-plugin-magnon-obfuscator");
  assert.strictEqual(obf.apply, "build");
  assert.strictEqual(obf.enforce, "post");
  assert.strictEqual(typeof obf.buildStart, "function");
  assert.strictEqual(typeof obf.generateBundle, "function");
  assert.strictEqual(typeof obf.closeBundle, "function");

  obf.buildStart();

  const bundle = {
    "assets/index-abc.js": {
      type: "chunk",
      fileName: "assets/index-abc.js",
      isEntry: true,
      code: "function mainApp() { var flag = 1; return flag; } mainApp();",
      modules: {
        "/project/src/index.tsx": {},
      },
    },
    "assets/secret-chunk.js": {
      type: "chunk",
      fileName: "assets/secret-chunk.js",
      isEntry: false,
      code: "function secretLogic() { var token = 'xyz987'; return token; }",
      modules: {
        "/project/src/secret-module.ts": {},
      },
    },
    "assets/vendor.js": {
      type: "chunk",
      fileName: "assets/vendor.js",
      isEntry: false,
      code: "function vendorReact() { return 'react'; }",
      modules: {
        "/project/node_modules/react/index.js": {},
      },
    },
  };

  await obf.generateBundle({}, bundle);
  obf.closeBundle();

  assert(bundle["assets/index-abc.js"].code.includes("debugger") || bundle["assets/index-abc.js"].code.includes("setInterval"));
  assert.notStrictEqual(bundle["assets/secret-chunk.js"].code, "function secretLogic() { var token = 'xyz987'; return token; }");
  assert.strictEqual(bundle["assets/vendor.js"].code, "function vendorReact() { return 'react'; }");

  console.log("  PASS: Parallel obfuscator Vite plugin lifecycle hooks and bundle processing");
}

function testNativeCompression() {
  const sampleData = Buffer.from('function example() { return 42; }\n'.repeat(50));
  const gz = magnon.compressGzip(sampleData, 6);
  assert(gz.length < sampleData.length);
  assert.strictEqual(gz[0], 0x1f);
  assert.strictEqual(gz[1], 0x8b);

  const br = magnon.compressBrotli(sampleData, 5);
  assert(br.length < sampleData.length);

  const tmpDir = path.join(__dirname, 'tmp_compress_test');
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });

  const testFile = path.join(tmpDir, 'test.js');
  fs.writeFileSync(testFile, 'export const value = 12345;\n'.repeat(100));

  const batchResult = magnon.compressDirectory(tmpDir, {
    gzip: true,
    brotli: true,
    threshold: 100,
    verbose: false,
  });

  assert.strictEqual(batchResult.totalFiles, 1);
  assert(fs.existsSync(testFile + '.gz'));
  assert(fs.existsSync(testFile + '.br'));
  assert(batchResult.durationMs >= 0);

  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('  PASS: Native multi-threaded Brotli and Gzip batch compression');
}

function testRolldownCjsInterop() {
  const plugin = magnon();
  const rawCode = "u=(n,r,o)=>(o=n==null?{}:e(i(n)),l(r||!n||!n.__esModule||!a.call(n,`default`)?t(o,`default`,{value:n,enumerable:!0}):o,n))";
  const renderChunkHandler = typeof plugin.renderChunk === 'function' ? plugin.renderChunk : plugin.renderChunk.handler;
  const renderRes = renderChunkHandler(rawCode, { fileName: "assets/rolldown-runtime.js" });
  assert(renderRes && renderRes.code);
  assert.strictEqual(
    renderRes.code,
    "u=(n,r,o)=>(o=n==null?{}:e(i(n)),l((!n||!a.call(n,`default`))?t(o,`default`,{value:n,enumerable:!0}):o,n))"
  );

  const bundle = {
    "assets/rolldown-runtime-xyz.js": {
      type: "chunk",
      fileName: "assets/rolldown-runtime-xyz.js",
      code: rawCode
    },
    "assets/rolldown-runtime-abc.js": {
      type: "chunk",
      fileName: "assets/rolldown-runtime-abc.js",
      code: "x=(e,t,p)=>(p=e==null?{}:r(m(e)),k(t||!e||!e.__esModule||!q.call(e,\"default\")?d(p,\"default\",{value:e,enumerable:!0}):p,e))"
    }
  };
  plugin.generateBundle({}, bundle);
  assert.strictEqual(
    bundle["assets/rolldown-runtime-xyz.js"].code,
    "u=(n,r,o)=>(o=n==null?{}:e(i(n)),l((!n||!a.call(n,`default`))?t(o,`default`,{value:n,enumerable:!0}):o,n))"
  );
  assert.strictEqual(
    bundle["assets/rolldown-runtime-abc.js"].code,
    "x=(e,t,p)=>(p=e==null?{}:r(m(e)),k((!e||!q.call(e,\"default\"))?d(p,\"default\",{value:e,enumerable:!0}):p,e))"
  );
  console.log('  PASS: Rolldown CJS/ESM interop patching for default export namespaces');
}

async function runAllTests() {
  testSingleTransform();
  testOptimizePackageImports();
  testModularizeImports();
  testSplitChunks();
  testCodeSplittingPresets();
  testExtendedLibraryModularization();
  testBatchTransform();
  await testVitePluginHooks();
  testNativeCompression();
  testRolldownCjsInterop();
  await testObfuscatorPlugin();

  console.log('\nAll Magnon integration tests passed successfully.');
}

runAllTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
