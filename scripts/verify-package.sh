#!/usr/bin/env bash
set -euo pipefail

echo "=== CamoFox Package Contract Verification ==="
echo ""

# Configuration
EXPECTED_NODE_FLOOR="20"
EXPECTED_PLAYWRIGHT_CORE="1.58.1"
EXPECTED_BINS=("camofox" "camofox-browser")
EXPECTED_FILES=("package.json" "README.md" "CHANGELOG.md" "LICENSE" "plugin.ts" "openclaw.plugin.json")
EXPECTED_DIRS=("dist" "bin")

FAIL=0
fail() { echo "FAIL: $1"; FAIL=1; }
pass() { echo "PASS: $1"; }
cleanup() { rm -rf "${EXTRACT_DIR:-}" "${EXTRACT_DIR2:-}" "${INSTALL_DIR:-}" "${TARBALL_PATH:-}" 2>/dev/null || true; }
trap cleanup EXIT

# Step 1: Build
echo "--- Step 1: Build ---"
npm run build
echo ""

# Step 2: Pack
echo "--- Step 2: Pack ---"
TARBALL=$(npm pack --pack-destination /tmp 2>/dev/null | tail -1)
TARBALL_PATH="/tmp/${TARBALL}"
if [ ! -f "$TARBALL_PATH" ]; then
  echo "FAIL: npm pack did not produce a tarball"
  exit 1
fi
pass "Tarball created: ${TARBALL}"
echo ""

# Step 3: Inspect tarball contents
echo "--- Step 3: Tarball Contents ---"
CONTENTS=$(tar tzf "$TARBALL_PATH")

for f in "${EXPECTED_FILES[@]}"; do
  if echo "$CONTENTS" | grep -q "^package/${f}$"; then
    pass "Tarball contains ${f}"
  else
    fail "Tarball missing ${f}"
  fi
done

for d in "${EXPECTED_DIRS[@]}"; do
  if echo "$CONTENTS" | grep -q "^package/${d}/"; then
    pass "Tarball contains ${d}/"
  else
    fail "Tarball missing ${d}/"
  fi
done

# Verify bin entrypoints exist
for b in "${EXPECTED_BINS[@]}"; do
  if echo "$CONTENTS" | grep -q "^package/bin/${b}.js$"; then
    pass "Tarball contains bin/${b}.js"
  else
    fail "Tarball missing bin/${b}.js"
  fi
done
echo ""

# Step 4: Validate manifest metadata from tarball
echo "--- Step 4: Manifest Metadata ---"
EXTRACT_DIR=$(mktemp -d)
tar xzf "$TARBALL_PATH" -C "$EXTRACT_DIR" package/package.json

PKG_NODE=$(node -e "console.log(require('${EXTRACT_DIR}/package/package.json').engines.node)")
if echo "$PKG_NODE" | grep -q ">=${EXPECTED_NODE_FLOOR}"; then
  pass "Node floor: ${PKG_NODE}"
else
  fail "Node floor mismatch: got ${PKG_NODE}, expected >=${EXPECTED_NODE_FLOOR}"
fi

PKG_MAIN=$(node -e "console.log(require('${EXTRACT_DIR}/package/package.json').main)")
if echo "$CONTENTS" | grep -q "^package/${PKG_MAIN}$"; then
  pass "Main entry ${PKG_MAIN} exists in tarball"
else
  fail "Main entry ${PKG_MAIN} missing from tarball"
fi

# Check commander is in dependencies
HAS_COMMANDER=$(node -e "const d=require('${EXTRACT_DIR}/package/package.json').dependencies||{}; console.log(d.commander ? 'yes' : 'no')")
if [ "$HAS_COMMANDER" = "yes" ]; then
  pass "commander listed in dependencies"
else
  fail "commander missing from dependencies"
fi

# Check argon2 in optionalDependencies
HAS_ARGON2=$(node -e "const d=require('${EXTRACT_DIR}/package/package.json').optionalDependencies||{}; console.log(d.argon2 ? 'yes' : 'no')")
if [ "$HAS_ARGON2" = "yes" ]; then
  pass "argon2 listed in optionalDependencies"
else
  fail "argon2 missing from optionalDependencies"
fi

rm -rf "$EXTRACT_DIR"
echo ""

# Step 5: Plugin manifest parity
echo "--- Step 5: Plugin Manifest ---"
EXTRACT_DIR2=$(mktemp -d)
tar xzf "$TARBALL_PATH" -C "$EXTRACT_DIR2" package/package.json package/openclaw.plugin.json

PKG_VER=$(node -e "console.log(require('${EXTRACT_DIR2}/package/package.json').version)")
PLUGIN_VER=$(node -e "console.log(require('${EXTRACT_DIR2}/package/openclaw.plugin.json').version)")
if [ "$PKG_VER" = "$PLUGIN_VER" ]; then
  pass "Plugin version matches package version: ${PKG_VER}"
else
  fail "Version mismatch: package=${PKG_VER}, plugin=${PLUGIN_VER}"
fi

# Check openclaw.extensions target exists in tarball
PLUGIN_EXT=$(node -e "const e=require('${EXTRACT_DIR2}/package/package.json').openclaw?.extensions||[]; e.forEach(f=>console.log(f))")
for ext in $PLUGIN_EXT; do
  if echo "$CONTENTS" | grep -q "^package/${ext}$"; then
    pass "openclaw extension ${ext} exists in tarball"
  else
    fail "openclaw extension ${ext} missing from tarball"
  fi
done

rm -rf "$EXTRACT_DIR2"
echo ""

# Step 6: Clean install smoke test
echo "--- Step 6: Clean Install Smoke ---"
INSTALL_DIR=$(mktemp -d)
cd "$INSTALL_DIR"
npm init -y --silent >/dev/null 2>&1
# Install from tarball — skip optional deps to avoid native compilation dependency
npm install "$TARBALL_PATH" --ignore-scripts --no-optional 2>/dev/null

# Verify bins are accessible
for b in "${EXPECTED_BINS[@]}"; do
  BIN_PATH="./node_modules/.bin/${b}"
  if [ -f "$BIN_PATH" ] || [ -L "$BIN_PATH" ]; then
    pass "Bin ${b} installed"
  else
    fail "Bin ${b} not found after install"
  fi
done

# Verify installed bins actually execute
for b in "${EXPECTED_BINS[@]}"; do
  BIN_PATH="./node_modules/.bin/${b}"
  if "$BIN_PATH" --help >/dev/null 2>&1; then
    pass "Bin ${b} executes (--help)"
  else
    fail "Bin ${b} exists but does not execute"
  fi
done

# Verify main entry resolves
MAIN_RESOLVE=$(node -e "try{require.resolve('camofox-browser');console.log('ok')}catch{console.log('fail')}")
if [ "$MAIN_RESOLVE" = "ok" ]; then
  pass "Main entry resolves via require('camofox-browser')"
else
  fail "Main entry does not resolve"
fi

INSTALLED_PLAYWRIGHT_CORE=$(node -e "console.log(require('playwright-core/package.json').version)")
if [ "$INSTALLED_PLAYWRIGHT_CORE" = "$EXPECTED_PLAYWRIGHT_CORE" ]; then
  pass "playwright-core resolved to ${EXPECTED_PLAYWRIGHT_CORE}"
else
  fail "playwright-core resolved to ${INSTALLED_PLAYWRIGHT_CORE}, expected ${EXPECTED_PLAYWRIGHT_CORE}"
fi

# Verify plugin.ts is accessible in installed package
if [ -f "./node_modules/camofox-browser/plugin.ts" ]; then
  pass "plugin.ts accessible in installed package"
else
  fail "plugin.ts not found in installed package"
fi

if [ -f "./node_modules/camofox-browser/openclaw.plugin.json" ]; then
  pass "openclaw.plugin.json accessible in installed package"
else
  fail "openclaw.plugin.json not found in installed package"
fi

cd - >/dev/null
rm -rf "$INSTALL_DIR"
echo ""

# Clean up tarball
rm -f "$TARBALL_PATH"

# Summary
echo "=== Summary ==="
if [ $FAIL -eq 0 ]; then
  echo "ALL CHECKS PASSED"
  exit 0
else
  echo "SOME CHECKS FAILED"
  exit 1
fi
