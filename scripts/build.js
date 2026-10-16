const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const isRelease = !process.argv.includes('--debug');
const profile = isRelease ? 'release' : 'debug';

console.log(`Building Magnon native binaries in ${profile} mode...`);

const buildCommand = isRelease
  ? 'cargo build --release -p magnon-node -p magnon-cli'
  : 'cargo build -p magnon-node -p magnon-cli';

execSync(buildCommand, { cwd: rootDir, stdio: 'inherit' });

const targetDir = path.join(rootDir, 'target', profile);
const packageDir = path.join(rootDir, 'packages', 'magnon');

let sourceSo = path.join(targetDir, 'libmagnon_node.so');
if (!fs.existsSync(sourceSo)) {
  sourceSo = path.join(targetDir, 'magnon_node.dll');
}
if (!fs.existsSync(sourceSo)) {
  sourceSo = path.join(targetDir, 'libmagnon_node.dylib');
}

const destNode = path.join(packageDir, 'magnon.node');

if (fs.existsSync(sourceSo)) {
  fs.copyFileSync(sourceSo, destNode);
  console.log(`Copied native binary to: ${destNode}`);
} else {
  console.error(`Native library not found in: ${targetDir}`);
  process.exit(1);
}

const sourceCli = path.join(targetDir, 'magnon');
const destCli = path.join(packageDir, 'bin', 'magnon-native');
if (fs.existsSync(sourceCli)) {
  fs.copyFileSync(sourceCli, destCli);
  fs.chmodSync(destCli, 0o755);
}

console.log('Build completed successfully.');
