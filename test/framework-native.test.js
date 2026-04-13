/**
 * CTO-07 — Framework-native verification depth.
 *
 * Each fixture is a minimal repo that has real framework-native
 * verification wired up (pytest in pyproject.toml, flutter test in
 * CONTRIBUTING.md, xcodebuild in a workflow, gradle test in build.gradle)
 * BUT nothing about it inside CLAUDE.md. The auditor must still recognise
 * the verification surface — otherwise mature Mobile / Python / ML repos
 * get zero uplift from NERVIQ (the 2026-04-08 UAT trust-break).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  hasDocumentedTestCommand,
  hasDocumentedLintCommand,
  hasDocumentedBuildCommand,
  getRepoInstructionBundle,
} = require('../src/instruction-surfaces');
const { ProjectContext } = require('../src/context');
const {
  hasIosXcodeProject,
  hasAndroidGradle,
  hasFlutterProject,
  hasPythonPoetry,
  hasPythonUv,
  hasPythonPdm,
  hasPythonHatch,
  hasFastApiProject,
  hasMlScaffolding,
  hasConfiguredTooling,
} = require('../src/techniques/shared');

function mk(name) { return fs.mkdtempSync(path.join(os.tmpdir(), `fn-${name}-`)); }
function rm(dir) { fs.rmSync(dir, { recursive: true, force: true }); }
function w(dir, rel, content) {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
}

describe('CTO-07 — framework-native verification detection', () => {
  test('Flutter: `flutter test` in CONTRIBUTING.md counts as a test command', () => {
    const dir = mk('flutter-test');
    try {
      w(dir, 'pubspec.yaml', 'name: demo\nflutter:\n  sdk: flutter\n');
      w(dir, 'CONTRIBUTING.md', '# Contributing\n\nRun `flutter test` before submitting a PR.\n');
      w(dir, 'CLAUDE.md', '# Project\nShort.\n');
      const ctx = new ProjectContext(dir);
      expect(hasDocumentedTestCommand(getRepoInstructionBundle(ctx))).toBe(true);
      expect(hasFlutterProject(ctx)).toBe(true);
    } finally { rm(dir); }
  });

  test('Flutter: `flutter analyze` in CONTRIBUTING.md counts as a lint command', () => {
    const dir = mk('flutter-lint');
    try {
      w(dir, 'pubspec.yaml', 'name: demo\nflutter:\n  sdk: flutter\n');
      w(dir, 'CONTRIBUTING.md', 'Lint: `flutter analyze` && `dart format --set-exit-if-changed .`\n');
      const ctx = new ProjectContext(dir);
      expect(hasDocumentedLintCommand(getRepoInstructionBundle(ctx))).toBe(true);
    } finally { rm(dir); }
  });

  test('iOS Swift: `xcodebuild test` in a GH workflow counts as a test command', () => {
    const dir = mk('ios-xcodebuild');
    try {
      w(dir, 'Package.swift', '// swift-tools-version:5.5\nimport PackageDescription\n');
      w(dir, '.github/workflows/ci.yml', 'jobs:\n  test:\n    steps:\n      - run: xcodebuild -scheme Demo test\n');
      const ctx = new ProjectContext(dir);
      expect(hasDocumentedTestCommand(getRepoInstructionBundle(ctx))).toBe(true);
      expect(hasIosXcodeProject(ctx)).toBe(true);
    } finally { rm(dir); }
  });

  test('iOS Swift: `swift test` counts as a test command', () => {
    const dir = mk('swift-test');
    try {
      w(dir, 'Package.swift', '// swift-tools-version:5.5\n');
      w(dir, 'README.md', 'Run `swift test` to verify.\n');
      const ctx = new ProjectContext(dir);
      expect(hasDocumentedTestCommand(getRepoInstructionBundle(ctx))).toBe(true);
    } finally { rm(dir); }
  });

  test('Android: `./gradlew test` in build.gradle-adjacent docs counts', () => {
    const dir = mk('gradle-test');
    try {
      w(dir, 'build.gradle.kts', 'plugins { kotlin("jvm") }\n');
      w(dir, 'CONTRIBUTING.md', 'Run `./gradlew test` and `./gradlew ktlintCheck`.\n');
      const ctx = new ProjectContext(dir);
      expect(hasDocumentedTestCommand(getRepoInstructionBundle(ctx))).toBe(true);
      expect(hasDocumentedLintCommand(getRepoInstructionBundle(ctx))).toBe(true);
      expect(hasAndroidGradle(ctx)).toBe(true);
    } finally { rm(dir); }
  });

  test('Python: pytest configured in pyproject.toml is visible to auditor', () => {
    const dir = mk('py-pytest');
    try {
      w(dir, 'pyproject.toml',
        '[project]\nname = "demo"\n\n[tool.pytest.ini_options]\ntestpaths = ["tests"]\n');
      w(dir, 'CLAUDE.md', '# Project\nNo commands documented.\n');
      const ctx = new ProjectContext(dir);
      expect(hasDocumentedTestCommand(getRepoInstructionBundle(ctx))).toBe(true);
      expect(hasConfiguredTooling(ctx, 'pytest')).toBe(true);
    } finally { rm(dir); }
  });

  test('Python: [tool.ruff] in pyproject.toml counts as a lint surface', () => {
    const dir = mk('py-ruff');
    try {
      w(dir, 'pyproject.toml',
        '[project]\nname = "demo"\n\n[tool.ruff]\nline-length = 100\n');
      const ctx = new ProjectContext(dir);
      expect(hasDocumentedLintCommand(getRepoInstructionBundle(ctx))).toBe(true);
      expect(hasConfiguredTooling(ctx, 'ruff')).toBe(true);
    } finally { rm(dir); }
  });

  test('Python: [tool.mypy] in pyproject.toml counts as a lint/type surface', () => {
    const dir = mk('py-mypy');
    try {
      w(dir, 'pyproject.toml',
        '[project]\nname = "demo"\n\n[tool.mypy]\nstrict = true\n');
      const ctx = new ProjectContext(dir);
      expect(hasDocumentedLintCommand(getRepoInstructionBundle(ctx))).toBe(true);
      expect(hasConfiguredTooling(ctx, 'mypy')).toBe(true);
    } finally { rm(dir); }
  });

  test('Python Poetry: [tool.poetry] + `poetry run pytest` detected', () => {
    const dir = mk('py-poetry');
    try {
      w(dir, 'pyproject.toml',
        '[tool.poetry]\nname = "demo"\nversion = "0.1"\n\n[tool.poetry.dependencies]\npython = "^3.11"\n');
      w(dir, 'README.md', 'Run tests with `poetry run pytest -xvs`.\n');
      const ctx = new ProjectContext(dir);
      expect(hasPythonPoetry(ctx)).toBe(true);
      expect(hasDocumentedTestCommand(getRepoInstructionBundle(ctx))).toBe(true);
    } finally { rm(dir); }
  });

  test('Python uv: uv.lock + `uv run pytest` detected', () => {
    const dir = mk('py-uv');
    try {
      w(dir, 'pyproject.toml', '[project]\nname = "demo"\n');
      w(dir, 'uv.lock', '# uv lockfile\n');
      w(dir, 'Makefile', 'test:\n\tuv run pytest\n');
      const ctx = new ProjectContext(dir);
      expect(hasPythonUv(ctx)).toBe(true);
      expect(hasDocumentedTestCommand(getRepoInstructionBundle(ctx))).toBe(true);
    } finally { rm(dir); }
  });

  test('Python PDM and Hatch signals detected', () => {
    const dirP = mk('py-pdm');
    try {
      w(dirP, 'pyproject.toml', '[project]\nname = "demo"\n\n[tool.pdm]\ndistribution = true\n');
      w(dirP, 'pdm.lock', '# pdm\n');
      expect(hasPythonPdm(new ProjectContext(dirP))).toBe(true);
    } finally { rm(dirP); }

    const dirH = mk('py-hatch');
    try {
      w(dirH, 'pyproject.toml', '[project]\nname = "demo"\n\n[tool.hatch.envs.default]\ndependencies = []\n');
      expect(hasPythonHatch(new ProjectContext(dirH))).toBe(true);
    } finally { rm(dirH); }
  });

  test('FastAPI dependency detected in pyproject.toml', () => {
    const dir = mk('fastapi');
    try {
      w(dir, 'pyproject.toml',
        '[project]\nname = "demo"\ndependencies = ["fastapi>=0.110", "uvicorn"]\n');
      const ctx = new ProjectContext(dir);
      expect(hasFastApiProject(ctx)).toBe(true);
    } finally { rm(dir); }
  });

  test('ML scaffolding: torch dependency OR .ipynb notebooks detected', () => {
    const dirDep = mk('ml-dep');
    try {
      w(dirDep, 'pyproject.toml',
        '[project]\nname = "ml"\ndependencies = ["torch", "transformers"]\n');
      expect(hasMlScaffolding(new ProjectContext(dirDep))).toBe(true);
    } finally { rm(dirDep); }

    const dirNb = mk('ml-nb');
    try {
      w(dirNb, 'pyproject.toml', '[project]\nname = "ml"\n');
      w(dirNb, 'notebooks/explore.ipynb', '{"cells":[],"metadata":{}}\n');
      expect(hasMlScaffolding(new ProjectContext(dirNb))).toBe(true);
    } finally { rm(dirNb); }
  });

  test('Makefile / justfile test targets count as documented test commands', () => {
    const dirMk = mk('makefile');
    try {
      w(dirMk, 'Makefile', '.PHONY: test\ntest:\n\tpython -m pytest\n');
      expect(hasDocumentedTestCommand(getRepoInstructionBundle(new ProjectContext(dirMk)))).toBe(true);
    } finally { rm(dirMk); }

    const dirJf = mk('justfile');
    try {
      w(dirJf, 'justfile', 'test:\n    cargo test\n');
      expect(hasDocumentedTestCommand(getRepoInstructionBundle(new ProjectContext(dirJf)))).toBe(true);
    } finally { rm(dirJf); }
  });

  test('pre-commit config counts as documented lint surface', () => {
    const dir = mk('precommit');
    try {
      w(dir, '.pre-commit-config.yaml',
        'repos:\n  - repo: https://github.com/astral-sh/ruff-pre-commit\n    hooks:\n      - id: ruff\n');
      const ctx = new ProjectContext(dir);
      expect(hasDocumentedLintCommand(getRepoInstructionBundle(ctx))).toBe(true);
    } finally { rm(dir); }
  });

  test('Mature Python ML repo (fixture): testCommand + lintCommand now PASS', async () => {
    // Integration-style: mimics Aider-AI/aider shape — pytest + ruff
    // configured in pyproject.toml but nothing in CLAUDE.md.
    const { audit } = require('../src/public-api');
    const dir = mk('mature-ml');
    try {
      w(dir, 'pyproject.toml',
        '[project]\nname = "aider-like"\ndependencies = ["torch", "transformers", "fastapi"]\n' +
        '\n[tool.ruff]\nline-length = 100\n' +
        '\n[tool.mypy]\nstrict = true\n' +
        '\n[tool.pytest.ini_options]\ntestpaths = ["tests"]\n');
      w(dir, 'CLAUDE.md', '# Project\nMature ML project.\n');
      w(dir, 'tests/test_demo.py', 'def test_ok():\n    assert True\n');
      const result = await audit({ dir, platform: 'claude', silent: true });
      const byKey = Object.fromEntries(result.results.map(r => [r.key, r]));
      expect(byKey.testCommand && byKey.testCommand.passed).toBe(true);
      expect(byKey.lintCommand && byKey.lintCommand.passed).toBe(true);
    } finally { rm(dir); }
  });
});
