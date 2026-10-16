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
  assert(!tsRes.code.contains ? !tsRes.code.includes('interface Profile') : true);
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

function testVitePluginHooks() {
  const plugin = magnon({ jsxRuntime: 'automatic', compress: true });
  assert.strictEqual(plugin.name, 'vite-plugin-magnon');
  assert.strictEqual(plugin.enforce, 'pre');
  assert.strictEqual(typeof plugin.transform, 'function');
  assert.strictEqual(typeof plugin.buildStart, 'function');
  assert.strictEqual(typeof plugin.closeBundle, 'function');

  const sampleId = '/virtual/Component.tsx';
  const sampleCode = 'export const Component = () => <div>Hello Vite</div>;';
  const res = plugin.transform(sampleCode, sampleId);
  assert(res && res.code);
  assert(res.code.includes('react/jsx-runtime'));

  const ignoredId = '/virtual/node_modules/dep/index.js';
  const ignoredRes = plugin.transform('const a = 1;', ignoredId);
  assert.strictEqual(ignoredRes, null);

  const compPlugin = magnon.compression();
  assert.strictEqual(compPlugin.name, 'vite-plugin-magnon-compression');
  assert.strictEqual(compPlugin.apply, 'build');
  assert.strictEqual(typeof compPlugin.closeBundle, 'function');

  console.log('  PASS: Vite plugin lifecycle hooks and compression integration');
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

testSingleTransform();
testBatchTransform();
testVitePluginHooks();
testNativeCompression();

console.log('\nAll Magnon integration tests passed successfully.');
