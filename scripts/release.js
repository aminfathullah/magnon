const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const cargoTomlPath = path.join(rootDir, 'Cargo.toml');
const rootPkgPath = path.join(rootDir, 'package.json');
const magnonPkgPath = path.join(rootDir, 'packages', 'magnon', 'package.json');

const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const noPublish = args.includes('--no-publish');
const noGit = args.includes('--no-git');
const otpArg = args.find(a => a.startsWith('--otp='));
const otp = otpArg ? otpArg.split('=')[1] : null;

const targetArg = args.find(a => !a.startsWith('--'));

function getCurrentVersion() {
  const pkg = JSON.parse(fs.readFileSync(magnonPkgPath, 'utf8'));
  return pkg.version;
}

function computeNextVersion(current, target) {
  if (!target || target === 'patch') {
    const parts = current.split('.').map(Number);
    parts[2] += 1;
    return parts.join('.');
  }
  if (target === 'minor') {
    const parts = current.split('.').map(Number);
    parts[1] += 1;
    parts[2] = 0;
    return parts.join('.');
  }
  if (target === 'major') {
    const parts = current.split('.').map(Number);
    parts[0] += 1;
    parts[1] = 0;
    parts[2] = 0;
    return parts.join('.');
  }
  if (/^\d+\.\d+\.\d+/.test(target)) {
    return target;
  }
  console.error(`Invalid version target: "${target}". Expected "patch", "minor", "major", or explicit version like "0.2.0".`);
  process.exit(1);
}

function updateVersionInFiles(newVersion) {
  const rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, 'utf8'));
  rootPkg.version = newVersion;
  fs.writeFileSync(rootPkgPath, JSON.stringify(rootPkg, null, 2) + '\n', 'utf8');

  const magnonPkg = JSON.parse(fs.readFileSync(magnonPkgPath, 'utf8'));
  magnonPkg.version = newVersion;
  fs.writeFileSync(magnonPkgPath, JSON.stringify(magnonPkg, null, 2) + '\n', 'utf8');

  let cargoToml = fs.readFileSync(cargoTomlPath, 'utf8');
  cargoToml = cargoToml.replace(
    /(\[workspace\.package\][\s\S]*?version\s*=\s*)"[^"]+"/,
    `$1"${newVersion}"`
  );
  fs.writeFileSync(cargoTomlPath, cargoToml, 'utf8');
}

function runCommand(cmd, cwd = rootDir) {
  console.log(`\x1b[36m>\x1b[0m ${cmd}`);
  execSync(cmd, { cwd, stdio: 'inherit' });
}

const currentVersion = getCurrentVersion();
const nextVersion = computeNextVersion(currentVersion, targetArg);

console.log(`\n\x1b[1mMagnon Release Orchestrator\x1b[0m`);
console.log(`Current version : \x1b[33m${currentVersion}\x1b[0m`);
console.log(`Target version  : \x1b[32m${nextVersion}\x1b[0m`);
if (isDryRun) {
  console.log(`\x1b[35m[DRY RUN MODE]\x1b[0m No files will be published or committed.\n`);
}

console.log(`\n\x1b[1mStep 1: Running test suite...\x1b[0m`);
runCommand('cargo test --all');
runCommand('node test/test_package.js');

console.log(`\n\x1b[1mStep 2: Synchronizing versions across workspace...\x1b[0m`);
if (!isDryRun) {
  updateVersionInFiles(nextVersion);
  console.log(`Updated Cargo.toml, package.json, and packages/magnon/package.json to ${nextVersion}`);
} else {
  console.log(`[dry-run] Would update version files to ${nextVersion}`);
}

console.log(`\n\x1b[1mStep 3: Building release binaries...\x1b[0m`);
runCommand('node scripts/build.js');

if (!isDryRun && !noGit) {
  console.log(`\n\x1b[1mStep 4: Creating Git commit and release tag...\x1b[0m`);
  runCommand(`git add Cargo.toml Cargo.lock package.json packages/magnon/package.json`);
  runCommand(`git commit -m "chore(release): v${nextVersion}"`);
  runCommand(`git tag v${nextVersion}`);
  console.log(`\x1b[32m✓\x1b[0m Created commit and tag v${nextVersion}`);
}

if (!noPublish) {
  console.log(`\n\x1b[1mStep 5: Publishing to NPM registry...\x1b[0m`);
  const magnonDir = path.join(rootDir, 'packages', 'magnon');
  if (isDryRun) {
    runCommand('npm pack --dry-run', magnonDir);
    console.log(`\x1b[32m✓\x1b[0m [dry-run] Tarball packaging verified successfully for version ${nextVersion}!`);
  } else {
    let publishCmd = 'npm publish --access public';
    if (otp) {
      publishCmd += ` --otp=${otp}`;
    }
    runCommand(publishCmd, magnonDir);
    console.log(`\x1b[32m✓\x1b[0m Successfully published magnon@${nextVersion} to NPM!`);
  }
}

if (!isDryRun && !noGit) {
  console.log(`\nTo push the release to GitHub, run:`);
  console.log(`  \x1b[36mgit push && git push --tags\x1b[0m\n`);
}
