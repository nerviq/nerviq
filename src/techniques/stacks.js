/**
 * Stacks technique fragments.
 * Generated mechanically from the legacy techniques.js monolith during HR-09.
 */

const {
  path,
  findProjectFiles,
  hasProjectFile,
  readProjectFiles,
  isPythonProject,
  isGoProject,
  isRustProject,
  isJavaProject,
  isFlutterProject,
  isSwiftProject,
  isKotlinProject,
  getMainPythonFiles,
  getPythonProjectText,
  getGoFiles,
  getRustFiles,
  getMainRustFiles,
  getMainJavaFiles,
  getMainGoFiles,
  getWorkflowContent,
  getPreCommitContent,
  getGoProjectText,
  getRustProjectText,
  getJavaBuildText,
  getJavaProjectText,
  getGoInterfaceBlocks,
  countGoInterfaceMethods,
  attachSourceUrls,
} = require('./shared');

module.exports = {
  pyprojectTomlExists: {
      id: 120001,
      name: 'pyproject.toml exists for Python packaging',
      check: (ctx) => { if (!isPythonProject(ctx)) return null; return hasProjectFile(ctx, /(^|\/)pyproject\.toml$/i); },
      impact: 'high',
      category: 'python',
      fix: 'Add pyproject.toml to declare modern Python packaging, tooling, and metadata.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  pythonTypeHints: {
      id: 120002,
      name: 'Type hints used in Python code',
      check: (ctx) => {
        if (!isPythonProject(ctx)) return null;
        if (hasProjectFile(ctx, /(^|\/)(mypy\.ini|py\.typed|pyrightconfig\.json)$/i)) return true;
        const pyproject = readProjectFiles(ctx, /(^|\/)pyproject\.toml$/i);
        if (/\[tool\.(mypy|pyright)\]/i.test(pyproject)) return true;
        const files = getMainPythonFiles(ctx);
        if (files.length === 0) return null;
        return files.some(file => /from typing import|import typing|from __future__ import annotations|->\s*[\w\[\]., ]+|:\s*[\w\[\]., ]+\s*=/.test(ctx.fileContent(file) || ''));
      },
      impact: 'medium',
      category: 'python',
      fix: 'Add type hints in main Python modules or configure mypy/pyright with py.typed support.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  pythonLinter: {
      id: 120003,
      name: 'Python linter configured',
      check: (ctx) => {
        if (!isPythonProject(ctx)) return null;
        const config = `${getPythonProjectText(ctx)}\n${readProjectFiles(ctx, /(^|\/)(\.flake8|\.pylintrc|pylintrc|ruff\.toml|\.ruff\.toml)$/i)}`;
        return /\[tool\.ruff\]|\[flake8\]|\[tool\.flake8\]|\[tool\.pylint\]|ruff|flake8|pylint/i.test(config);
      },
      impact: 'medium',
      category: 'python',
      fix: 'Configure a Python linter such as ruff, flake8, or pylint in pyproject.toml or a dedicated config file.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  pythonFormatter: {
      id: 120004,
      name: 'Python formatter configured',
      check: (ctx) => {
        if (!isPythonProject(ctx)) return null;
        const pyproject = getPythonProjectText(ctx);
        const prettier = readProjectFiles(ctx, /(^|\/)\.prettierrc(\.(json|ya?ml|toml))?$/i);
        return /\[tool\.black\]|\[tool\.ruff\.format\]|\[tool\.isort\]/i.test(pyproject) ||
          /python|\.py\b/i.test(prettier);
      },
      impact: 'medium',
      category: 'python',
      fix: 'Configure formatting with black, ruff format, isort, or a Prettier override that explicitly covers Python files.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  pythonTestFramework: {
      id: 120005,
      name: 'Python test framework present',
      check: (ctx) => {
        if (!isPythonProject(ctx)) return null;
        return /\[tool\.pytest/i.test(getPythonProjectText(ctx)) ||
          hasProjectFile(ctx, /(^|\/)(pytest\.ini|tox\.ini|conftest\.py)$/i);
      },
      impact: 'high',
      category: 'python',
      fix: 'Add pytest.ini, conftest.py, tox.ini, or pyproject.toml pytest configuration so the test framework is explicit.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  pythonVenvIgnored: {
      id: 120006,
      name: 'Virtual environment directories ignored in git',
      check: (ctx) => {
        if (!isPythonProject(ctx)) return null;
        const gitignore = ctx.fileContent('.gitignore') || '';
        return /(^|\n)\s*\.venv\/?\s*($|\n)|(^|\n)\s*venv\/?\s*($|\n)|(^|\n)\s*env\/?\s*($|\n)/i.test(gitignore);
      },
      impact: 'medium',
      category: 'python',
      fix: 'Ignore `.venv/`, `venv/`, or `env/` in .gitignore so local environments do not get committed.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  pythonRequirementsPinned: {
      id: 120007,
      name: 'Requirements files use pinned versions',
      check: (ctx) => {
        if (!isPythonProject(ctx)) return null;
        const files = findProjectFiles(ctx, /(^|\/)requirements[^/]*\.txt$/i);
        if (files.length === 0) return null;
        const lines = files
          .flatMap(file => (ctx.fileContent(file) || '').split(/\r?\n/))
          .map(line => line.trim())
          .filter(line => line && !line.startsWith('#'));
        if (lines.length === 0) return null;
        return lines.every(line => /^(-r|-c|--)/.test(line) || /==| @ /.test(line));
      },
      impact: 'high',
      category: 'python',
      fix: 'Pin Python requirements with `==` or direct references so installs stay reproducible.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  pythonSecurityScanner: {
      id: 120008,
      name: 'Python security scanner configured',
      check: (ctx) => {
        if (!isPythonProject(ctx)) return null;
        const content = `${getPythonProjectText(ctx)}\n${getWorkflowContent(ctx)}\n${getPreCommitContent(ctx)}`;
        return /bandit|pip-audit|safety/i.test(content);
      },
      impact: 'medium',
      category: 'python',
      fix: 'Configure bandit, safety, or pip-audit in dependencies, pre-commit, or CI.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  pythonPreCommitHooks: {
      id: 120009,
      name: 'pre-commit configured with Python hooks',
      check: (ctx) => {
        if (!isPythonProject(ctx)) return null;
        const preCommit = getPreCommitContent(ctx);
        if (!preCommit) return false;
        return /ruff|black|mypy|pyupgrade|pytest|bandit|isort|flake8|pylint/i.test(preCommit);
      },
      impact: 'medium',
      category: 'python',
      fix: 'Add `.pre-commit-config.yaml` with Python-focused hooks such as ruff, black, mypy, or bandit.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  pythonDocstrings: {
      id: 120010,
      name: 'Docstrings present in main Python files',
      check: (ctx) => {
        if (!isPythonProject(ctx)) return null;
        const files = getMainPythonFiles(ctx);
        if (files.length === 0) return null;
        return files.some(file => /(^|\n)\s*(def|class)\s+\w+.*:\s*\n\s*("""|''')|^\s*("""|''')/m.test(ctx.fileContent(file) || ''));
      },
      impact: 'low',
      category: 'python',
      fix: 'Add module, class, or function docstrings in the main Python source files.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  pythonCIConfigured: {
      id: 120011,
      name: 'CI runs Python tests',
      check: (ctx) => {
        if (!isPythonProject(ctx)) return null;
        return /pytest|python -m pytest|python -m unittest|tox\b|nox\b/i.test(getWorkflowContent(ctx));
      },
      impact: 'high',
      category: 'python',
      fix: 'Run Python tests in CI with pytest, unittest, tox, or nox.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  pythonCoverage: {
      id: 120012,
      name: 'Python coverage configured',
      check: (ctx) => {
        if (!isPythonProject(ctx)) return null;
        const content = `${getPythonProjectText(ctx)}\n${getWorkflowContent(ctx)}\n${readProjectFiles(ctx, /(^|\/)\.coveragerc$/i)}`;
        return /\[tool\.coverage|pytest-cov|coverage\b|--cov\b/i.test(content);
      },
      impact: 'medium',
      category: 'python',
      fix: 'Configure coverage.py or pytest-cov in project config or CI.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  pythonPackageManager: {
      id: 120013,
      name: 'Modern Python package manager lockfile present',
      check: (ctx) => { if (!isPythonProject(ctx)) return null; return hasProjectFile(ctx, /(^|\/)(poetry\.lock|pdm\.lock|uv\.lock|Pipfile\.lock)$/); },
      impact: 'medium',
      category: 'python',
      fix: 'Commit a Poetry, PDM, uv, or Pipenv lockfile for reproducible dependency resolution.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  pythonMinVersionSpecified: {
      id: 120014,
      name: 'Minimum Python version specified',
      check: (ctx) => {
        if (!isPythonProject(ctx)) return null;
        const content = `${getPythonProjectText(ctx)}\n${readProjectFiles(ctx, /(^|\/)\.python-version$/i)}`;
        return /requires-python|python_requires|(^|\n)\s*python\s*=|^\s*\d+\.\d+(\.\d+)?\s*$/im.test(content);
      },
      impact: 'medium',
      category: 'python',
      fix: 'Specify the supported Python version with `.python-version`, `requires-python`, or `python_requires`.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  pythonAsyncPatterns: {
      id: 120015,
      name: 'Async Python patterns used',
      check: (ctx) => {
        if (!isPythonProject(ctx)) return null;
        const content = `${getPythonProjectText(ctx)}\n${getMainPythonFiles(ctx).slice(0, 30).map(file => ctx.fileContent(file) || '').join('\n')}`;
        return /asyncio|aiohttp|fastapi|starlette|trio|anyio|async def|await /i.test(content);
      },
      impact: 'low',
      category: 'python',
      fix: 'Adopt explicit async patterns such as asyncio, aiohttp, FastAPI, or `async def` where concurrent workflows matter.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  pythonEnvExample: {
      id: 120016,
      name: 'Python project includes an environment example file',
      check: (ctx) => { if (!isPythonProject(ctx)) return null; return hasProjectFile(ctx, /(^|\/)\.env(\.example|\.sample)$/i); },
      impact: 'medium',
      category: 'python',
      fix: 'Add `.env.example` or `.env.sample` so required Python environment variables are documented.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  pythonMigrations: {
      id: 120017,
      name: 'Python database migration tooling present',
      check: (ctx) => {
        if (!isPythonProject(ctx)) return null;
        const content = `${getPythonProjectText(ctx)}\n${getMainPythonFiles(ctx).slice(0, 20).map(file => ctx.fileContent(file) || '').join('\n')}`;
        return /alembic|django\.db\.migrations|makemigrations|migrate/i.test(content) ||
          hasProjectFile(ctx, /(^|\/)alembic\.ini$/i) ||
          hasProjectFile(ctx, /(^|\/)(alembic|migrations)\//i);
      },
      impact: 'medium',
      category: 'python',
      fix: 'Use Alembic or Django migrations and keep the migration surface committed in the repo.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  pythonLogging: {
      id: 120018,
      name: 'Python structured logging configured',
      check: (ctx) => {
        if (!isPythonProject(ctx)) return null;
        const content = `${getPythonProjectText(ctx)}\n${getMainPythonFiles(ctx).slice(0, 30).map(file => ctx.fileContent(file) || '').join('\n')}`;
        return /structlog|loguru|logging\.config|dictConfig|getLogger|basicConfig/i.test(content);
      },
      impact: 'medium',
      category: 'python',
      fix: 'Configure logging with Python logging config, structlog, or loguru for consistent operational signals.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  pythonAPISchema: {
      id: 120019,
      name: 'Python API schema or model definitions present',
      check: (ctx) => {
        if (!isPythonProject(ctx)) return null;
        const content = `${getPythonProjectText(ctx)}\n${getMainPythonFiles(ctx).slice(0, 30).map(file => ctx.fileContent(file) || '').join('\n')}`;
        return /openapi|swagger|BaseModel|pydantic|Schema\)|marshmallow|TypedDict/i.test(content);
      },
      impact: 'medium',
      category: 'python',
      fix: 'Define API schemas with OpenAPI, Pydantic, Marshmallow, or typed request/response models.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  pythonContainerized: {
      id: 120020,
      name: 'Python container image uses a Python base',
      check: (ctx) => {
        if (!isPythonProject(ctx)) return null;
        const dockerfile = ctx.fileContent('Dockerfile') || '';
        if (!dockerfile) return null;
        return /FROM\s+python[:\d.-]/i.test(dockerfile);
      },
      impact: 'medium',
      category: 'python',
      fix: 'Use an official Python image such as `python:3.12-slim` when containerizing Python services.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  pythonDependencyGroups: {
      id: 120021,
      name: 'Python dev and test dependency groups separated',
      check: (ctx) => {
        if (!isPythonProject(ctx)) return null;
        const content = getPythonProjectText(ctx);
        return /\[tool\.poetry\.group\.[^\]]+\]|\[project\.optional-dependencies\]|extras_require|dependency-groups/i.test(content);
      },
      impact: 'medium',
      category: 'python',
      fix: 'Separate Python dev and test dependencies with Poetry groups, optional-dependencies, or extras_require.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  pythonPathConfig: {
      id: 120022,
      name: 'Python tool path configuration present',
      check: (ctx) => {
        if (!isPythonProject(ctx)) return null;
        if (hasProjectFile(ctx, /(^|\/)pyrightconfig\.json$/i)) return true;
        const vscodeSettings = findProjectFiles(ctx, /(^|\/)\.vscode\/settings\.json$/i)
          .map(file => ctx.jsonFile(file) || {})
          .find(settings => Object.keys(settings).some(key => key.toLowerCase().includes('python')));
        return !!vscodeSettings;
      },
      impact: 'low',
      category: 'python',
      fix: 'Add `pyrightconfig.json` or VS Code Python settings so tooling resolves imports and environments consistently.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  pythonMonorepo: {
      id: 120023,
      name: 'Python monorepo-friendly package layout present',
      check: (ctx) => {
        if (!isPythonProject(ctx)) return null;
        const content = getPythonProjectText(ctx);
        return ctx.hasDir('src') ||
          /namespace_packages|find_namespace:|from\s*=\s*["']src["']|package-dir/i.test(content);
      },
      impact: 'low',
      category: 'python',
      fix: 'Use a `src/` layout or namespace package configuration for larger multi-package Python repos.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  pythonErrorHandling: {
      id: 120024,
      name: 'Custom Python exception classes defined',
      check: (ctx) => {
        if (!isPythonProject(ctx)) return null;
        const files = getMainPythonFiles(ctx);
        if (files.length === 0) return null;
        return files.some(file => /class\s+\w+(Error|Exception)\s*\((?:[\w.]*Exception|[\w.]*Error)\)\s*:/i.test(ctx.fileContent(file) || ''));
      },
      impact: 'low',
      category: 'python',
      fix: 'Define custom exception classes for domain-specific Python error handling instead of only raising generic exceptions.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  pythonDataValidation: {
      id: 120025,
      name: 'Python data validation library used',
      check: (ctx) => {
        if (!isPythonProject(ctx)) return null;
        const content = `${getPythonProjectText(ctx)}\n${getMainPythonFiles(ctx).slice(0, 30).map(file => ctx.fileContent(file) || '').join('\n')}`;
        return /pydantic|marshmallow|attrs|attr\.s|BaseModel|Schema\)/i.test(content);
      },
      impact: 'medium',
      category: 'python',
      fix: 'Use Pydantic, Marshmallow, attrs, or similar validation libraries for structured Python inputs and models.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  goModExists: {
      id: 120101,
      name: 'go.mod exists for Go module management',
      check: (ctx) => { if (!isGoProject(ctx)) return null; return true; },
      impact: 'high',
      category: 'go',
      fix: 'Initialize the repository as a Go module with `go mod init` and commit `go.mod`.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  goLinter: {
      id: 120102,
      name: 'Go linter configured',
      check: (ctx) => {
        if (!isGoProject(ctx)) return null;
        const content = `${getGoProjectText(ctx)}\n${readProjectFiles(ctx, /(^|\/)\.golangci\.(ya?ml|toml)$/i)}`;
        return /\.golangci\.|golangci-lint/i.test(content);
      },
      impact: 'medium',
      category: 'go',
      fix: 'Configure golangci-lint in the repo or CI for consistent Go lint enforcement.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  goTestFiles: {
      id: 120103,
      name: 'Go test files present',
      check: (ctx) => { if (!isGoProject(ctx)) return null; return hasProjectFile(ctx, /_test\.go$/i); },
      impact: 'high',
      category: 'go',
      fix: 'Add `_test.go` files so Go packages have executable unit or integration tests.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  goVet: {
      id: 120104,
      name: 'go vet runs in automation',
      check: (ctx) => {
        if (!isGoProject(ctx)) return null;
        const content = `${getWorkflowContent(ctx)}\n${ctx.fileContent('Makefile') || ''}`;
        return /go vet/i.test(content);
      },
      impact: 'medium',
      category: 'go',
      fix: 'Run `go vet` in CI or the project Makefile to catch common Go mistakes.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  goFmt: {
      id: 120105,
      name: 'gofmt or goimports enforced',
      check: (ctx) => {
        if (!isGoProject(ctx)) return null;
        const content = `${getWorkflowContent(ctx)}\n${ctx.fileContent('Makefile') || ''}\n${getPreCommitContent(ctx)}`;
        return /gofmt|goimports/i.test(content);
      },
      impact: 'medium',
      category: 'go',
      fix: 'Run `gofmt` or `goimports` in CI, pre-commit, or developer tooling.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  goModTidy: {
      id: 120106,
      name: 'go mod tidy runs in automation',
      check: (ctx) => {
        if (!isGoProject(ctx)) return null;
        const content = `${getWorkflowContent(ctx)}\n${ctx.fileContent('Makefile') || ''}`;
        return /go mod tidy/i.test(content);
      },
      impact: 'medium',
      category: 'go',
      fix: 'Run `go mod tidy` in CI or the Makefile so module metadata stays clean.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  goBuildTags: {
      id: 120107,
      name: 'Go build tags or constraints used',
      check: (ctx) => {
        if (!isGoProject(ctx)) return null;
        const files = getGoFiles(ctx);
        if (files.length === 0) return null;
        return files.some(file => /\/\/go:build|\/\/ \+build/.test(ctx.fileContent(file) || ''));
      },
      impact: 'low',
      category: 'go',
      fix: 'Use `//go:build` constraints when a Go package depends on build tags or platform-specific variants.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  goErrorWrapping: {
      id: 120108,
      name: 'Go errors use wrapping patterns',
      check: (ctx) => {
        if (!isGoProject(ctx)) return null;
        const files = getMainGoFiles(ctx);
        if (files.length === 0) return null;
        return files.some(file => /fmt\.Errorf\([^)]*%w|errors\.Join\(/.test(ctx.fileContent(file) || ''));
      },
      impact: 'medium',
      category: 'go',
      fix: 'Wrap Go errors with `fmt.Errorf(... %w ...)` or similar patterns to preserve context.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  goInterfaceSegregation: {
      id: 120109,
      name: 'Go interfaces stay small',
      check: (ctx) => {
        if (!isGoProject(ctx)) return null;
        const interfaces = getGoInterfaceBlocks(ctx);
        if (interfaces.length === 0) return null;
        return interfaces.every(block => countGoInterfaceMethods(block) <= 5);
      },
      impact: 'low',
      category: 'go',
      fix: 'Keep Go interfaces small and focused; split interfaces that define more than five methods.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  goContextUsage: {
      id: 120110,
      name: 'Go services use context.Context',
      check: (ctx) => {
        if (!isGoProject(ctx)) return null;
        const files = getMainGoFiles(ctx);
        if (files.length === 0) return null;
        return files.some(file => /context\.Context|context\.With(Cancel|Timeout|Deadline)|ctx\s+context\.Context/.test(ctx.fileContent(file) || ''));
      },
      impact: 'medium',
      category: 'go',
      fix: 'Pass `context.Context` through handlers and services so cancellation and deadlines are propagated correctly.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  goStructTags: {
      id: 120111,
      name: 'Exported Go structs include tags',
      check: (ctx) => {
        if (!isGoProject(ctx)) return null;
        const structBlocks = [];
        for (const file of getMainGoFiles(ctx)) {
          const content = ctx.fileContent(file) || '';
          for (const match of content.matchAll(/type\s+([A-Z]\w*)\s+struct\s*\{([\s\S]*?)\}/g)) {
            structBlocks.push(match[2]);
          }
        }
        if (structBlocks.length === 0) return null;
        return structBlocks.some(block => /`[^`]*(json|yaml|db):"/.test(block));
      },
      impact: 'low',
      category: 'go',
      fix: 'Add struct tags such as `json`, `yaml`, or `db` on exported Go types that cross boundaries.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  goMakefile: {
      id: 120112,
      name: 'Go Makefile includes build, test, and lint targets',
      check: (ctx) => {
        if (!isGoProject(ctx)) return null;
        const makefile = ctx.fileContent('Makefile') || '';
        if (!makefile) return false;
        return /^\s*build:/m.test(makefile) && /^\s*test:/m.test(makefile) && /^\s*lint:/m.test(makefile);
      },
      impact: 'medium',
      category: 'go',
      fix: 'Add a Makefile with `build`, `test`, and `lint` targets for common Go workflows.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  goDocComments: {
      id: 120113,
      name: 'Exported Go functions have doc comments',
      check: (ctx) => {
        if (!isGoProject(ctx)) return null;
        const files = getMainGoFiles(ctx);
        if (files.length === 0) return null;
        const documented = files.some(file => /\/\/\s*[A-Z]\w+.*\nfunc\s+(?:\([^)]+\)\s*)?[A-Z]\w+\s*\(/.test(ctx.fileContent(file) || ''));
        const exported = files.some(file => /func\s+(?:\([^)]+\)\s*)?[A-Z]\w+\s*\(/.test(ctx.fileContent(file) || ''));
        if (!exported) return null;
        return documented;
      },
      impact: 'low',
      category: 'go',
      fix: 'Add Go doc comments above exported functions so package APIs remain self-describing.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  goSecurityScanner: {
      id: 120114,
      name: 'Go security scanner configured',
      check: (ctx) => {
        if (!isGoProject(ctx)) return null;
        return /gosec|staticcheck/i.test(getGoProjectText(ctx));
      },
      impact: 'medium',
      category: 'go',
      fix: 'Configure `gosec` or `staticcheck` in CI or the Makefile for Go security and static analysis checks.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  goCIConfigured: {
      id: 120115,
      name: 'CI runs Go tests',
      check: (ctx) => {
        if (!isGoProject(ctx)) return null;
        return /go test(\s|$)|go test \.\/\.\.\./i.test(getWorkflowContent(ctx));
      },
      impact: 'high',
      category: 'go',
      fix: 'Run `go test ./...` in CI so Go packages are verified on every change.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  goContainerized: {
      id: 120116,
      name: 'Go Dockerfile uses multi-stage build',
      check: (ctx) => {
        if (!isGoProject(ctx)) return null;
        const dockerfile = ctx.fileContent('Dockerfile') || '';
        if (!dockerfile) return null;
        return /FROM\s+golang[:\d.-].*\bAS\b/i.test(dockerfile) &&
          /FROM\s+(alpine|scratch|distroless|gcr\.io|cgr\.dev)/i.test(dockerfile);
      },
      impact: 'medium',
      category: 'go',
      fix: 'Use a multi-stage Go Dockerfile: compile in a `golang` image and run from a minimal final image.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  goCoverageConfigured: {
      id: 120117,
      name: 'Go coverage reporting configured',
      check: (ctx) => {
        if (!isGoProject(ctx)) return null;
        const content = `${getWorkflowContent(ctx)}\n${ctx.fileContent('Makefile') || ''}`;
        return /go test[^\n]*-cover/i.test(content);
      },
      impact: 'medium',
      category: 'go',
      fix: 'Add `go test -cover` to CI or developer commands so Go coverage is tracked explicitly.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  goAPIFramework: {
      id: 120118,
      name: 'Go HTTP framework detected',
      check: (ctx) => {
        if (!isGoProject(ctx)) return null;
        return /gin-gonic\/gin|labstack\/echo|gofiber\/fiber|go-chi\/chi|gin\.Default\(|echo\.New\(|fiber\.New\(|chi\.NewRouter\(/i.test(getGoProjectText(ctx));
      },
      impact: 'low',
      category: 'go',
      fix: 'Use a well-supported Go HTTP framework such as Gin, Echo, Fiber, or Chi when building API services.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  goMigrationTool: {
      id: 120119,
      name: 'Go database migration tooling present',
      check: (ctx) => {
        if (!isGoProject(ctx)) return null;
        return /golang-migrate|pressly\/goose|atlasgo|atlas\s/i.test(getGoProjectText(ctx)) ||
          hasProjectFile(ctx, /(^|\/)(migrations|db\/migrations)\//i);
      },
      impact: 'medium',
      category: 'go',
      fix: 'Add a Go migration tool such as golang-migrate, goose, or Atlas and keep migration files in the repo.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  goDependencyInjection: {
      id: 120120,
      name: 'Go dependency injection pattern present',
      check: (ctx) => {
        if (!isGoProject(ctx)) return null;
        return /google\/wire|uber-go\/fx|uber-go\/dig|wire\.Build\(|fx\.New\(|dig\.New\(/i.test(getGoProjectText(ctx));
      },
      impact: 'low',
      category: 'go',
      fix: 'Use Wire, Fx, Dig, or an equivalent composition pattern when Go dependency graphs become complex.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  cargoTomlExists: {
      id: 120201,
      name: 'Cargo.toml exists',
      check: (ctx) => {
        if (!isRustProject(ctx)) return null;
        return true;
      },
      impact: 'high',
      category: 'rust',
      fix: 'Add a `Cargo.toml` manifest so Rust dependencies, metadata, and build settings are tracked explicitly.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  rustEdition: {
      id: 120202,
      name: 'Rust edition specified in Cargo.toml',
      check: (ctx) => {
        if (!isRustProject(ctx)) return null;
        return /edition\s*=\s*"20(18|21|24)"/i.test(readProjectFiles(ctx, /(^|\/)Cargo\.toml$/i));
      },
      impact: 'high',
      category: 'rust',
      fix: 'Specify a Rust edition such as `edition = "2021"` in `Cargo.toml` so tooling and language semantics are pinned.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  rustClippy: {
      id: 120203,
      name: 'Clippy configured',
      check: (ctx) => {
        if (!isRustProject(ctx)) return null;
        return hasProjectFile(ctx, /(^|\/)(clippy\.toml|\.clippy\.toml)$/i) ||
          /clippy/i.test(`${readProjectFiles(ctx, /(^|\/)\.cargo\/config\.toml$/i)}\n${getWorkflowContent(ctx)}\n${getPreCommitContent(ctx)}`);
      },
      impact: 'medium',
      category: 'rust',
      fix: 'Configure `cargo clippy` in CI, pre-commit, or `.cargo/config.toml` so linting is enforced consistently.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  rustFmt: {
      id: 120204,
      name: 'rustfmt configured',
      check: (ctx) => {
        if (!isRustProject(ctx)) return null;
        return hasProjectFile(ctx, /(^|\/)(rustfmt\.toml|\.rustfmt\.toml)$/i);
      },
      impact: 'medium',
      category: 'rust',
      fix: 'Add `rustfmt.toml` or `.rustfmt.toml` to capture Rust formatting expectations in version control.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  rustTestsExist: {
      id: 120205,
      name: 'Rust tests exist',
      check: (ctx) => {
        if (!isRustProject(ctx)) return null;
        const files = getRustFiles(ctx);
        if (files.length === 0) return null;
        return hasProjectFile(ctx, /(^|\/)tests\//i) ||
          files.some(file => /#\s*\[\s*test\s*\]/.test(ctx.fileContent(file) || ''));
      },
      impact: 'high',
      category: 'rust',
      fix: 'Add Rust unit or integration tests using `#[test]` functions or a `tests/` directory.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  rustBenchmarks: {
      id: 120206,
      name: 'Rust benchmarks present',
      check: (ctx) => {
        if (!isRustProject(ctx)) return null;
        return hasProjectFile(ctx, /(^|\/)benches\//i) ||
          /#\s*\[\s*bench\s*\]|criterion/i.test(getRustProjectText(ctx));
      },
      impact: 'low',
      category: 'rust',
      fix: 'Add Rust benchmarks through `benches/`, `criterion`, or benchmark annotations when performance-sensitive code matters.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  rustCIConfigured: {
      id: 120207,
      name: 'CI runs cargo test',
      check: (ctx) => {
        if (!isRustProject(ctx)) return null;
        return /cargo test(\s|$)/i.test(getWorkflowContent(ctx));
      },
      impact: 'high',
      category: 'rust',
      fix: 'Run `cargo test` in CI so Rust correctness is verified automatically on every change.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  rustCargoLock: {
      id: 120208,
      name: 'Cargo.lock handling is appropriate',
      check: (ctx) => {
        if (!isRustProject(ctx)) return null;
        const cargoText = readProjectFiles(ctx, /(^|\/)Cargo\.toml$/i);
        const hasLock = hasProjectFile(ctx, /(^|\/)Cargo\.lock$/i);
        const gitignore = ctx.fileContent('.gitignore') || '';
        const libraryOnly = /\[lib\]/i.test(cargoText) && !/\[\[bin\]\]|src\/main\.rs/i.test(getRustProjectText(ctx));
        if (libraryOnly) return hasLock || /(^|\r?\n)\s*Cargo\.lock\s*$/m.test(gitignore);
        return hasLock;
      },
      impact: 'medium',
      category: 'rust',
      fix: 'Commit `Cargo.lock` for binaries, or explicitly ignore it for library-only crates when that is your chosen policy.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  rustUnsafeBlocks: {
      id: 120209,
      name: 'Unsafe blocks are documented',
      check: (ctx) => {
        if (!isRustProject(ctx)) return null;
        const files = getRustFiles(ctx);
        const unsafeFiles = files.filter(file => /\bunsafe\b/.test(ctx.fileContent(file) || ''));
        if (unsafeFiles.length === 0) return true;
        return unsafeFiles.every(file => /SAFETY:|\/\/\s*SAFETY|\/\*\s*SAFETY/i.test(ctx.fileContent(file) || ''));
      },
      impact: 'medium',
      category: 'rust',
      fix: 'Document each `unsafe` block with a nearby `SAFETY:` comment explaining the invariants being upheld.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  rustErrorHandling: {
      id: 120210,
      name: 'Rust error handling strategy present',
      check: (ctx) => {
        if (!isRustProject(ctx)) return null;
        return /thiserror|anyhow|eyre|impl\s+std::error::Error|enum\s+\w+Error|struct\s+\w+Error/i.test(getRustProjectText(ctx));
      },
      impact: 'medium',
      category: 'rust',
      fix: 'Use `thiserror`, `anyhow`, or explicit error types so Rust errors remain structured and descriptive.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  rustAsync: {
      id: 120211,
      name: 'Rust async runtime configured',
      check: (ctx) => {
        if (!isRustProject(ctx)) return null;
        return /tokio|async-std|smol/i.test(readProjectFiles(ctx, /(^|\/)Cargo\.toml$/i));
      },
      impact: 'medium',
      category: 'rust',
      fix: 'Declare an async runtime such as Tokio or async-std when the Rust project uses asynchronous workflows.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  rustSerde: {
      id: 120212,
      name: 'Serde serialization configured',
      check: (ctx) => {
        if (!isRustProject(ctx)) return null;
        return /\bserde(_json|_yaml)?\b/i.test(readProjectFiles(ctx, /(^|\/)Cargo\.toml$/i));
      },
      impact: 'low',
      category: 'rust',
      fix: 'Add `serde` and related crates when Rust data crosses process, storage, or network boundaries.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  rustDocComments: {
      id: 120213,
      name: 'Public Rust items have doc comments',
      check: (ctx) => {
        if (!isRustProject(ctx)) return null;
        const files = getMainRustFiles(ctx);
        const exported = files.some(file => /\bpub\s+(fn|struct|enum|trait|mod|const|type)\b/.test(ctx.fileContent(file) || ''));
        if (!exported) return null;
        return files.some(file => /\/\/\/[^\n]*\n\s*pub\s+(fn|struct|enum|trait|mod|const|type)\b/.test(ctx.fileContent(file) || ''));
      },
      impact: 'low',
      category: 'rust',
      fix: 'Add `///` doc comments above public Rust APIs so crates are easier to consume and maintain.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  rustSecurityAudit: {
      id: 120214,
      name: 'Rust security audit tooling configured',
      check: (ctx) => {
        if (!isRustProject(ctx)) return null;
        return /cargo-audit|cargo deny|cargo-deny/i.test(getRustProjectText(ctx));
      },
      impact: 'medium',
      category: 'rust',
      fix: 'Configure `cargo-audit` or `cargo-deny` in CI or project automation to scan Rust dependencies for risk.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  rustMSRV: {
      id: 120215,
      name: 'Minimum supported Rust version specified',
      check: (ctx) => {
        if (!isRustProject(ctx)) return null;
        return /rust-version\s*=/.test(readProjectFiles(ctx, /(^|\/)Cargo\.toml$/i));
      },
      impact: 'medium',
      category: 'rust',
      fix: 'Set `rust-version` in `Cargo.toml` so the project’s MSRV is explicit for contributors and CI.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  rustWorkspace: {
      id: 120216,
      name: 'Cargo workspace configured for multi-crate projects',
      check: (ctx) => {
        if (!isRustProject(ctx)) return null;
        const cargoFiles = findProjectFiles(ctx, /(^|\/)Cargo\.toml$/i);
        if (cargoFiles.length <= 1) return null;
        return /\[workspace\]/i.test(readProjectFiles(ctx, /(^|\/)Cargo\.toml$/i));
      },
      impact: 'medium',
      category: 'rust',
      fix: 'Add a root Cargo workspace when the Rust repository contains multiple crates.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  rustBuildScript: {
      id: 120217,
      name: 'Rust build script present when needed',
      check: (ctx) => {
        if (!isRustProject(ctx)) return null;
        return hasProjectFile(ctx, /(^|\/)build\.rs$/i);
      },
      impact: 'low',
      category: 'rust',
      fix: 'Use `build.rs` when the project needs generated bindings, codegen, or compile-time environment setup.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  rustFeatureFlags: {
      id: 120218,
      name: 'Rust feature flags defined',
      check: (ctx) => {
        if (!isRustProject(ctx)) return null;
        return /\[features\]/i.test(readProjectFiles(ctx, /(^|\/)Cargo\.toml$/i));
      },
      impact: 'low',
      category: 'rust',
      fix: 'Define Cargo feature flags when Rust functionality needs optional capabilities or slimmed dependency sets.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  rustCrossCompilation: {
      id: 120219,
      name: 'Rust cross-compilation targets configured',
      check: (ctx) => {
        if (!isRustProject(ctx)) return null;
        return /--target|rustup target add|target\.[\w.-]+|cross build|cross test|cargo zigbuild/i.test(getRustProjectText(ctx));
      },
      impact: 'low',
      category: 'rust',
      fix: 'Configure Rust cross-compilation targets in CI or `.cargo/config.toml` when builds must run across architectures or platforms.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  rustContainerized: {
      id: 120220,
      name: 'Rust Dockerfile present',
      check: (ctx) => {
        if (!isRustProject(ctx)) return null;
        return /FROM\s+rust|cargo\s+(build|chef|install|test)/i.test(ctx.fileContent('Dockerfile') || '');
      },
      impact: 'low',
      category: 'rust',
      fix: 'Use a Dockerfile that references Rust or Cargo when the project’s build and release flow is containerized.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  mavenOrGradle: {
      id: 120301,
      name: 'Maven or Gradle build file exists',
      check: (ctx) => {
        if (!isJavaProject(ctx)) return null;
        return true;
      },
      impact: 'high',
      category: 'java',
      fix: 'Add `pom.xml`, `build.gradle`, or `build.gradle.kts` so the Java build is defined in version control.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  javaVersion: {
      id: 120302,
      name: 'Java version specified',
      check: (ctx) => {
        if (!isJavaProject(ctx)) return null;
        return /java\.version|maven\.compiler\.(source|target|release)|sourceCompatibility|targetCompatibility|JavaLanguageVersion|toolchain/i.test(getJavaBuildText(ctx)) ||
          hasProjectFile(ctx, /(^|\/)\.java-version$/i);
      },
      impact: 'high',
      category: 'java',
      fix: 'Specify the Java version in Maven or Gradle so compilation and runtime expectations stay explicit.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  springBootDetected: {
      id: 120303,
      name: 'Spring Boot detected',
      check: (ctx) => {
        if (!isJavaProject(ctx)) return null;
        return /spring-boot/i.test(getJavaBuildText(ctx));
      },
      impact: 'medium',
      category: 'java',
      fix: 'Use Spring Boot dependencies when the Java service relies on Spring auto-configuration and conventions.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  javaTestFramework: {
      id: 120304,
      name: 'Java test framework configured',
      check: (ctx) => {
        if (!isJavaProject(ctx)) return null;
        return /junit|testng|spring-boot-starter-test/i.test(getJavaBuildText(ctx));
      },
      impact: 'high',
      category: 'java',
      fix: 'Add JUnit, TestNG, or Spring Boot test dependencies so Java tests have a standard runner.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  javaLinter: {
      id: 120305,
      name: 'Java linter configured',
      check: (ctx) => {
        if (!isJavaProject(ctx)) return null;
        return /checkstyle|spotbugs|pmd/i.test(getJavaProjectText(ctx)) ||
          hasProjectFile(ctx, /(^|\/)(checkstyle\.xml|spotbugs.*\.xml|pmd\.xml)$/i);
      },
      impact: 'medium',
      category: 'java',
      fix: 'Configure Checkstyle, SpotBugs, or PMD so Java code quality rules run consistently.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  javaFormatter: {
      id: 120306,
      name: 'Java formatter configured',
      check: (ctx) => {
        if (!isJavaProject(ctx)) return null;
        return /google-java-format|spotless/i.test(getJavaBuildText(ctx)) ||
          hasProjectFile(ctx, /(^|\/)\.editorconfig$/i);
      },
      impact: 'medium',
      category: 'java',
      fix: 'Configure Spotless, google-java-format, or an `.editorconfig` so Java formatting stays consistent.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  javaCIConfigured: {
      id: 120307,
      name: 'CI runs Java tests',
      check: (ctx) => {
        if (!isJavaProject(ctx)) return null;
        return /(?:mvn|mvnw)\s+test|(?:gradle|gradlew)\s+test/i.test(getWorkflowContent(ctx));
      },
      impact: 'high',
      category: 'java',
      fix: 'Run `mvn test`, `mvnw test`, `gradle test`, or `gradlew test` in CI so Java changes are validated automatically.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  javaSecurityScanner: {
      id: 120308,
      name: 'Java security scanner configured',
      check: (ctx) => {
        if (!isJavaProject(ctx)) return null;
        return /dependency-check|snyk|spotbugs-security|findsecbugs/i.test(getJavaProjectText(ctx));
      },
      impact: 'medium',
      category: 'java',
      fix: 'Configure OWASP Dependency-Check, Snyk, or SpotBugs security rules for Java dependency and code scanning.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  javaDocumentation: {
      id: 120309,
      name: 'Java documentation configured',
      check: (ctx) => {
        if (!isJavaProject(ctx)) return null;
        if (/javadoc/i.test(getJavaBuildText(ctx))) return true;
        const files = getMainJavaFiles(ctx);
        const publicTypes = files.some(file => /\bpublic\s+(class|interface|enum|record)\s+[A-Z]\w*/.test(ctx.fileContent(file) || ''));
        if (!publicTypes) return null;
        return files.some(file => /\/\*\*[\s\S]*?\*\/\s*public\s+(class|interface|enum|record)\s+[A-Z]\w*/.test(ctx.fileContent(file) || ''));
      },
      impact: 'low',
      category: 'java',
      fix: 'Generate Javadocs or add doc comments on public Java types so the API remains understandable to contributors.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  javaProfiles: {
      id: 120310,
      name: 'Java profiles or build variants configured',
      check: (ctx) => {
        if (!isJavaProject(ctx)) return null;
        return /<profiles>|spring\.profiles|@Profile|profiles\s*\{|buildTypes\s*\{|productFlavors\s*\{/i.test(getJavaProjectText(ctx));
      },
      impact: 'low',
      category: 'java',
      fix: 'Use Maven profiles, Spring profiles, or Gradle build variants when Java environments need explicit separation.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  javaContainerized: {
      id: 120311,
      name: 'Java Dockerfile references Java build/runtime',
      check: (ctx) => {
        if (!isJavaProject(ctx)) return null;
        return /FROM\s+(?:maven|gradle|openjdk|eclipse-temurin|amazoncorretto)|\bjava\b|\bmvn\b|\bgradle\b/i.test(ctx.fileContent('Dockerfile') || '');
      },
      impact: 'low',
      category: 'java',
      fix: 'Use a Dockerfile or build image that references Java, Maven, or Gradle when the application is containerized.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  javaAPIFramework: {
      id: 120312,
      name: 'Java API framework detected',
      check: (ctx) => {
        if (!isJavaProject(ctx)) return null;
        return /spring-web|spring-boot-starter-web|@RestController|@Controller|javax\.ws\.rs|jakarta\.ws\.rs|micronaut-http|io\.micronaut/i.test(getJavaProjectText(ctx));
      },
      impact: 'low',
      category: 'java',
      fix: 'Use Spring MVC, JAX-RS, or Micronaut conventions explicitly when the Java project exposes an API.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  javaMigrations: {
      id: 120313,
      name: 'Java database migration tooling present',
      check: (ctx) => {
        if (!isJavaProject(ctx)) return null;
        return /flyway|liquibase/i.test(getJavaProjectText(ctx)) ||
          hasProjectFile(ctx, /(^|\/)(db\/migration|db\/migrations|migrations)\//i) ||
          hasProjectFile(ctx, /(^|\/)(schema|data)\.sql$/i);
      },
      impact: 'medium',
      category: 'java',
      fix: 'Add Flyway, Liquibase, or repo-managed migration files so Java schema changes are repeatable and reviewable.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  javaMessageQueue: {
      id: 120314,
      name: 'Java message queue integration detected',
      check: (ctx) => {
        if (!isJavaProject(ctx)) return null;
        return /kafka|rabbitmq|amqp|jms|spring-kafka|spring-rabbit/i.test(getJavaProjectText(ctx));
      },
      impact: 'low',
      category: 'java',
      fix: 'Use explicit Kafka, RabbitMQ, or JMS integrations when the Java service relies on asynchronous messaging.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  javaCaching: {
      id: 120315,
      name: 'Java caching configured',
      check: (ctx) => {
        if (!isJavaProject(ctx)) return null;
        return /redis|ehcache|spring-cache|@Cacheable|caffeine/i.test(getJavaProjectText(ctx));
      },
      impact: 'low',
      category: 'java',
      fix: 'Configure Redis, Ehcache, Caffeine, or Spring Cache when Java services benefit from explicit caching layers.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  javaMonitoring: {
      id: 120316,
      name: 'Java monitoring dependencies detected',
      check: (ctx) => {
        if (!isJavaProject(ctx)) return null;
        return /actuator|micrometer|prometheus/i.test(getJavaProjectText(ctx));
      },
      impact: 'medium',
      category: 'java',
      fix: 'Add Actuator, Micrometer, or Prometheus integrations so Java services expose health and metrics data.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  javaLogging: {
      id: 120317,
      name: 'Java logging configured',
      check: (ctx) => {
        if (!isJavaProject(ctx)) return null;
        return /slf4j|logback|log4j/i.test(getJavaProjectText(ctx)) ||
          hasProjectFile(ctx, /(^|\/)(logback.*\.xml|log4j2?.*\.xml)$/i);
      },
      impact: 'medium',
      category: 'java',
      fix: 'Use SLF4J, Logback, or Log4j so Java application logging is explicit and configurable.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  javaMultiModule: {
      id: 120318,
      name: 'Java multi-module structure configured',
      check: (ctx) => {
        if (!isJavaProject(ctx)) return null;
        const buildFiles = findProjectFiles(ctx, /(^|\/)(pom\.xml|build\.gradle|build\.gradle\.kts)$/i);
        if (buildFiles.length <= 1) return null;
        return /<modules>|include\s*\(|include\s+['":]/i.test(getJavaBuildText(ctx));
      },
      impact: 'medium',
      category: 'java',
      fix: 'Configure a root Maven or Gradle multi-module definition when the Java repository contains multiple modules.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  javaDependencyInjection: {
      id: 120319,
      name: 'Java dependency injection pattern present',
      check: (ctx) => {
        if (!isJavaProject(ctx)) return null;
        return /spring-context|guice|dagger|@Autowired|@Inject|@Bean|@Component|@Service/i.test(getJavaProjectText(ctx));
      },
      impact: 'medium',
      category: 'java',
      fix: 'Use Spring DI, Guice, or Dagger patterns so Java object graphs stay explicit and testable.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  javaPropertyFiles: {
      id: 120320,
      name: 'Java application property files exist',
      check: (ctx) => {
        if (!isJavaProject(ctx)) return null;
        return hasProjectFile(ctx, /(^|\/)application\.(properties|ya?ml)$/i);
      },
      impact: 'low',
      category: 'java',
      fix: 'Add `application.properties` or `application.yml` when the Java service relies on conventional runtime configuration files.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  rubyGemfileExists: {
      id: 'CL-RB01',
      name: 'Gemfile exists',
      check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; return true; },
      impact: 'high',
      category: 'ruby',
      fix: 'Create a Gemfile to manage Ruby dependencies.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  rubyGemfileLockCommitted: {
      id: 'CL-RB02',
      name: 'Gemfile.lock committed',
      check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; return ctx.files.some(f => /Gemfile\.lock$/.test(f)); },
      impact: 'high',
      category: 'ruby',
      fix: 'Commit Gemfile.lock to version control for reproducible builds.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  rubyVersionSpecified: {
      id: 'CL-RB03',
      name: 'Ruby version specified (.ruby-version)',
      check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; return ctx.files.some(f => /\.ruby-version$/.test(f)) || /ruby ['"]~?\d/i.test(ctx.fileContent('Gemfile') || ''); },
      impact: 'medium',
      category: 'ruby',
      fix: 'Create .ruby-version or specify ruby version in Gemfile.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  rubyRubocopConfigured: {
      id: 'CL-RB04',
      name: 'RuboCop configured (.rubocop.yml)',
      check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; return ctx.files.some(f => /\.rubocop\.ya?ml$/.test(f)); },
      impact: 'medium',
      category: 'ruby',
      fix: 'Add .rubocop.yml to configure Ruby style checking.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  rubyTestFrameworkConfigured: {
      id: 'CL-RB05',
      name: 'RSpec or Minitest configured (spec/ or test/)',
      check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; return ctx.files.some(f => /^spec\/|^test\/|spec_helper\.rb$|test_helper\.rb$/.test(f)); },
      impact: 'high',
      category: 'ruby',
      fix: 'Configure RSpec (spec/) or Minitest (test/) for testing.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  rubyRailsCredentialsDocumented: {
      id: 'CL-RB06',
      name: 'Rails credentials documented in instructions',
      check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; if (!ctx.files.some(f => /config\/credentials/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /credentials|encrypted|master\.key|secret_key_base/i.test(docs); },
      impact: 'high',
      category: 'ruby',
      fix: 'Document Rails credentials management (rails credentials:edit) in project instructions.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  rubyMigrationsDocumented: {
      id: 'CL-RB07',
      name: 'Database migrations documented (db/migrate/)',
      check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; if (!ctx.files.some(f => /db\/migrate\//.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /migration|migrate|db:migrate|rails db/i.test(docs); },
      impact: 'medium',
      category: 'ruby',
      fix: 'Document database migration workflow (rails db:migrate) in project instructions.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  rubyBundlerAuditConfigured: {
      id: 'CL-RB08',
      name: 'Bundler audit configured',
      check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; const gf = ctx.fileContent('Gemfile') || ''; return /bundler-audit|bundle.audit/i.test(gf) || ctx.files.some(f => /\.bundler-audit/i.test(f)); },
      impact: 'medium',
      category: 'ruby',
      fix: 'Add bundler-audit gem for dependency vulnerability scanning.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  rubyTypeCheckingConfigured: {
      id: 'CL-RB09',
      name: 'Sorbet/RBS type checking configured (sorbet/ or sig/)',
      check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; return ctx.files.some(f => /sorbet\/|sig\/|\.rbs$/.test(f)) || /sorbet|tapioca/i.test(ctx.fileContent('Gemfile') || ''); },
      impact: 'low',
      category: 'ruby',
      fix: 'Configure Sorbet or RBS for type checking.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  rubyRailsRoutesDocumented: {
      id: 'CL-RB10',
      name: 'Rails routes documented',
      check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; if (!ctx.files.some(f => /config\/routes\.rb$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /routes|endpoints|api.*path|REST/i.test(docs); },
      impact: 'medium',
      category: 'ruby',
      fix: 'Document key routes and API endpoints in project instructions.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  rubyBackgroundJobsDocumented: {
      id: 'CL-RB11',
      name: 'Background jobs documented (Sidekiq/GoodJob)',
      check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; const gf = ctx.fileContent('Gemfile') || ''; if (!/sidekiq|good_job|delayed_job|resque/i.test(gf)) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /sidekiq|good_job|delayed_job|resque|background.*job|worker|queue/i.test(docs); },
      impact: 'medium',
      category: 'ruby',
      fix: 'Document background job framework and worker configuration.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  rubyRailsEnvConfigsSeparated: {
      id: 'CL-RB12',
      name: 'Rails environment configs separated (config/environments/)',
      check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; return ctx.files.some(f => /config\/environments\//.test(f)); },
      impact: 'medium',
      category: 'ruby',
      fix: 'Ensure config/environments/ has separate files for development, test, and production.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  rubyAssetPipelineDocumented: {
      id: 'CL-RB13',
      name: 'Asset pipeline documented',
      check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; const gf = ctx.fileContent('Gemfile') || ''; if (!/sprockets|propshaft|webpacker|jsbundling|cssbundling/i.test(gf)) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /asset|sprockets|propshaft|webpacker|jsbundling|cssbundling|esbuild|vite/i.test(docs); },
      impact: 'low',
      category: 'ruby',
      fix: 'Document asset pipeline configuration (Sprockets, Propshaft, or JS/CSS bundling).',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  rubyMasterKeyInGitignore: {
      id: 'CL-RB14',
      name: 'Rails master.key in .gitignore',
      check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; if (!ctx.files.some(f => /config\/credentials/.test(f))) return null; const gi = ctx.fileContent('.gitignore') || ''; return /master\.key/i.test(gi); },
      impact: 'critical',
      category: 'ruby',
      fix: 'Add config/master.key to .gitignore to prevent secret leakage.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  rubyTestDataFactories: {
      id: 'CL-RB15',
      name: 'Factory Bot/fixtures for test data (spec/factories/)',
      check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; return ctx.files.some(f => /spec\/factories\/|test\/fixtures\//.test(f)) || /factory_bot|fabrication/i.test(ctx.fileContent('Gemfile') || ''); },
      impact: 'medium',
      category: 'ruby',
      fix: 'Configure Factory Bot (spec/factories/) or fixtures (test/fixtures/) for test data.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  dotnetProjectExists: {
      id: 'CL-DN01',
      name: '.csproj or .sln exists',
      check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; return true; },
      impact: 'high',
      category: 'dotnet',
      fix: 'Ensure .csproj or .sln file exists for .NET projects.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  dotnetVersionSpecified: {
      id: 'CL-DN02',
      name: '.NET version specified (global.json or TargetFramework)',
      check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; return ctx.files.some(f => /global\.json$/.test(f)) || ctx.files.some(f => { if (!/\.csproj$/.test(f)) return false; const c = ctx.fileContent(f) || ''; return /TargetFramework/i.test(c); }); },
      impact: 'medium',
      category: 'dotnet',
      fix: 'Create global.json or ensure TargetFramework is set in .csproj.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  dotnetPackagesLock: {
      id: 'CL-DN03',
      name: 'NuGet packages lock (packages.lock.json)',
      check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; return ctx.files.some(f => /packages\.lock\.json$/.test(f)); },
      impact: 'medium',
      category: 'dotnet',
      fix: 'Enable NuGet lock file (packages.lock.json) for reproducible restores.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  dotnetTestDocumented: {
      id: 'CL-DN04',
      name: 'dotnet test documented',
      check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /dotnet test|xunit|nunit|mstest/i.test(docs); },
      impact: 'high',
      category: 'dotnet',
      fix: 'Document how to run tests with dotnet test in project instructions.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  dotnetEditorConfigExists: {
      id: 'CL-DN05',
      name: 'EditorConfig configured (.editorconfig)',
      check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; return ctx.files.some(f => /\.editorconfig$/.test(f)); },
      impact: 'medium',
      category: 'dotnet',
      fix: 'Add .editorconfig for consistent code style across the team.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  dotnetRoslynAnalyzers: {
      id: 'CL-DN06',
      name: 'Roslyn analyzers configured',
      check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; return ctx.files.some(f => { if (!/\.csproj$/.test(f)) return false; const c = ctx.fileContent(f) || ''; return /Analyzer|StyleCop|SonarAnalyzer|Microsoft\.CodeAnalysis/i.test(c); }); },
      impact: 'medium',
      category: 'dotnet',
      fix: 'Add Roslyn analyzers (StyleCop.Analyzers, Microsoft.CodeAnalysis) to the project.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  dotnetAppsettingsExists: {
      id: 'CL-DN07',
      name: 'appsettings.json exists',
      check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; return ctx.files.some(f => /appsettings\.json$/.test(f)); },
      impact: 'medium',
      category: 'dotnet',
      fix: 'Create appsettings.json for application configuration.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  dotnetUserSecretsDocumented: {
      id: 'CL-DN08',
      name: 'User secrets configured in instructions',
      check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /user.?secrets|dotnet secrets|Secret Manager/i.test(docs); },
      impact: 'high',
      category: 'dotnet',
      fix: 'Document user secrets management (dotnet user-secrets) in project instructions.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  dotnetEfMigrations: {
      id: 'CL-DN09',
      name: 'Entity Framework migrations (Migrations/ directory)',
      check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; return ctx.files.some(f => /Migrations\//.test(f)); },
      impact: 'medium',
      category: 'dotnet',
      fix: 'Document Entity Framework migration workflow (dotnet ef migrations).',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  dotnetHealthChecks: {
      id: 'CL-DN10',
      name: 'Health checks configured',
      check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; return ctx.files.some(f => { if (!/\.cs$/.test(f)) return false; const c = ctx.fileContent(f) || ''; return /AddHealthChecks|MapHealthChecks|IHealthCheck/i.test(c); }); },
      impact: 'medium',
      category: 'dotnet',
      fix: 'Configure health checks with AddHealthChecks() and MapHealthChecks().',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  dotnetSwaggerConfigured: {
      id: 'CL-DN11',
      name: 'Swagger/OpenAPI configured',
      check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; return ctx.files.some(f => { if (!/\.cs$|.csproj$/.test(f)) return false; const c = ctx.fileContent(f) || ''; return /Swashbuckle|AddSwaggerGen|UseSwagger|NSwag|AddOpenApi/i.test(c); }); },
      impact: 'medium',
      category: 'dotnet',
      fix: 'Configure Swagger/OpenAPI with Swashbuckle or NSwag.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  dotnetNoConnectionStringsInConfig: {
      id: 'CL-DN12',
      name: 'No connection strings in appsettings.json',
      check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; const settings = ctx.fileContent('appsettings.json') || ''; if (!settings) return null; return !/Server=.*Password=|Data Source=.*Password=/i.test(settings); },
      impact: 'critical',
      category: 'dotnet',
      fix: 'Move connection strings with passwords to user secrets or environment variables.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  dotnetDockerSupport: {
      id: 'CL-DN13',
      name: 'Docker support configured',
      check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; const df = ctx.fileContent('Dockerfile') || ''; return /dotnet|aspnet|sdk/i.test(df); },
      impact: 'medium',
      category: 'dotnet',
      fix: 'Add Dockerfile with official .NET SDK/ASP.NET base images.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  dotnetTestProjectSeparate: {
      id: 'CL-DN14',
      name: 'Unit test project separate (.Tests.csproj)',
      check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; return ctx.files.some(f => /\.Tests?\.csproj$|Tests?\/.*\.csproj$/.test(f)); },
      impact: 'high',
      category: 'dotnet',
      fix: 'Create separate test project (e.g., MyApp.Tests.csproj) for unit tests.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  dotnetGlobalUsingsDocumented: {
      id: 'CL-DN15',
      name: 'GlobalUsings documented',
      check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; return ctx.files.some(f => /GlobalUsings\.cs$|Usings\.cs$/.test(f)) || ctx.files.some(f => { if (!/\.csproj$/.test(f)) return false; const c = ctx.fileContent(f) || ''; return /ImplicitUsings/i.test(c); }); },
      impact: 'low',
      category: 'dotnet',
      fix: 'Document global using directives in GlobalUsings.cs or enable ImplicitUsings in .csproj.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  phpComposerJsonExists: {
      id: 'CL-PHP01',
      name: 'composer.json exists',
      check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; return true; },
      impact: 'high',
      category: 'php',
      fix: 'Create composer.json to manage PHP dependencies.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  phpComposerLockCommitted: {
      id: 'CL-PHP02',
      name: 'composer.lock committed',
      check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; return ctx.files.some(f => /composer\.lock$/.test(f)); },
      impact: 'high',
      category: 'php',
      fix: 'Commit composer.lock to version control for reproducible installs.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  phpVersionSpecified: {
      id: 'CL-PHP03',
      name: 'PHP version specified (composer.json require.php)',
      check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; const cj = ctx.fileContent('composer.json') || ''; return /"php"s*:/i.test(cj); },
      impact: 'medium',
      category: 'php',
      fix: 'Specify PHP version requirement in composer.json require section.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  phpStaticAnalysisConfigured: {
      id: 'CL-PHP04',
      name: 'PHPStan/Psalm configured (phpstan.neon)',
      check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; return ctx.files.some(f => /phpstan\.neon$|phpstan\.neon\.dist$|psalm\.xml$/.test(f)); },
      impact: 'medium',
      category: 'php',
      fix: 'Configure PHPStan (phpstan.neon) or Psalm (psalm.xml) for static analysis.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  phpCsFixerConfigured: {
      id: 'CL-PHP05',
      name: 'PHP CS Fixer configured (.php-cs-fixer.php)',
      check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; return ctx.files.some(f => /\.php-cs-fixer\.php$|\.php-cs-fixer\.dist\.php$/.test(f)); },
      impact: 'medium',
      category: 'php',
      fix: 'Add .php-cs-fixer.php for consistent code formatting.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  phpUnitConfigured: {
      id: 'CL-PHP06',
      name: 'PHPUnit configured (phpunit.xml)',
      check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; return ctx.files.some(f => /phpunit\.xml$|phpunit\.xml\.dist$/.test(f)); },
      impact: 'high',
      category: 'php',
      fix: 'Configure PHPUnit with phpunit.xml for testing.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  phpLaravelEnvExample: {
      id: 'CL-PHP07',
      name: 'Laravel .env.example exists',
      check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; if (!ctx.files.some(f => /artisan$/.test(f))) return null; return ctx.files.some(f => /\.env\.example$/.test(f)); },
      impact: 'high',
      category: 'php',
      fix: 'Create .env.example with all required environment variables documented.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  phpLaravelAppKeyNotCommitted: {
      id: 'CL-PHP08',
      name: 'Laravel APP_KEY not committed',
      check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; if (!ctx.files.some(f => /artisan$/.test(f))) return null; const env = ctx.fileContent('.env') || ''; if (!env) return null; return !/APP_KEY=base64:[A-Za-z0-9+/=]{30,}/i.test(env); },
      impact: 'critical',
      category: 'php',
      fix: 'Ensure .env with APP_KEY is in .gitignore — never commit application keys.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  phpLaravelMigrationsExist: {
      id: 'CL-PHP09',
      name: 'Laravel migrations exist (database/migrations/)',
      check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; if (!ctx.files.some(f => /artisan$/.test(f))) return null; return ctx.files.some(f => /database\/migrations\//.test(f)); },
      impact: 'medium',
      category: 'php',
      fix: 'Create database migrations in database/migrations/ directory.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  phpArtisanCommandsDocumented: {
      id: 'CL-PHP10',
      name: 'Artisan commands documented',
      check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; if (!ctx.files.some(f => /artisan$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /artisan|php artisan|make:model|make:controller|migrate/i.test(docs); },
      impact: 'medium',
      category: 'php',
      fix: 'Document key Artisan commands (migrate, seed, make:*) in project instructions.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  phpQueueWorkerDocumented: {
      id: 'CL-PHP11',
      name: 'Queue worker documented',
      check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; const cj = ctx.fileContent('composer.json') || ''; if (!/horizon|queue/i.test(cj) && !ctx.files.some(f => /artisan$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /queue|horizon|worker|job|dispatch/i.test(docs); },
      impact: 'medium',
      category: 'php',
      fix: 'Document queue worker setup (php artisan queue:work, Horizon).',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  phpLaravelPintConfigured: {
      id: 'CL-PHP12',
      name: 'Laravel Pint configured (pint.json)',
      check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; return ctx.files.some(f => /pint\.json$/.test(f)) || /laravel\/pint/i.test(ctx.fileContent('composer.json') || ''); },
      impact: 'low',
      category: 'php',
      fix: 'Configure Laravel Pint (pint.json) for code style enforcement.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  phpAssetBundlingDocumented: {
      id: 'CL-PHP13',
      name: 'Vite/Mix asset bundling documented',
      check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; if (!ctx.files.some(f => /vite\.config\.|webpack\.mix\.js$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /vite|mix|asset|npm run dev|npm run build/i.test(docs); },
      impact: 'low',
      category: 'php',
      fix: 'Document asset bundling setup (Vite or Mix) in project instructions.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  phpConfigCachingDocumented: {
      id: 'CL-PHP14',
      name: 'Laravel config caching documented',
      check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; if (!ctx.files.some(f => /artisan$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /config:cache|config:clear|route:cache|optimize/i.test(docs); },
      impact: 'low',
      category: 'php',
      fix: 'Document config/route caching strategy (php artisan config:cache) for production.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  phpComposerScriptsDefined: {
      id: 'CL-PHP15',
      name: 'Composer scripts defined',
      check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; const cj = ctx.fileContent('composer.json') || ''; return /"scripts"s*:/i.test(cj); },
      impact: 'medium',
      category: 'php',
      fix: 'Define composer scripts for common tasks (test, lint, analyze) in composer.json.',
      // sourceUrl assigned by attachSourceUrls via category mapping
      confidence: 0.7,
    },

  pubspecExists: {
      id: 120401,
      name: 'pubspec.yaml exists',
      check: (ctx) => {
        if (!isFlutterProject(ctx)) return null;
        return true;
      },
      impact: 'high',
      category: 'flutter',
      fix: 'Add a `pubspec.yaml` manifest so Flutter/Dart dependencies and project metadata are tracked.',
      confidence: 0.7,
    },

  flutterAnalysis: {
      id: 120402,
      name: 'Flutter analysis options configured',
      check: (ctx) => {
        if (!isFlutterProject(ctx)) return null;
        return ctx.files.some(f => /analysis_options\.yaml$/i.test(f));
      },
      impact: 'medium',
      category: 'flutter',
      fix: 'Add analysis_options.yaml for Dart/Flutter linting rules.',
      confidence: 0.8,
    },

  flutterTestDir: {
      id: 120403,
      name: 'Flutter tests exist',
      check: (ctx) => {
        if (!isFlutterProject(ctx)) return null;
        return hasProjectFile(ctx, /(^|\/)test\/.*_test\.dart$/i);
      },
      impact: 'high',
      category: 'flutter',
      fix: 'Add Flutter widget or unit tests in a `test/` directory with `_test.dart` suffix.',
      confidence: 0.8,
    },

  flutterLintRules: {
      id: 120404,
      name: 'Flutter lint package configured',
      check: (ctx) => {
        if (!isFlutterProject(ctx)) return null;
        const pubspec = readProjectFiles(ctx, /(^|\/)pubspec\.yaml$/i);
        return /flutter_lints|very_good_analysis/i.test(pubspec);
      },
      impact: 'medium',
      category: 'flutter',
      fix: 'Add `flutter_lints` or `very_good_analysis` to pubspec.yaml dev_dependencies for consistent linting.',
      confidence: 0.8,
    },

  flutterPlatformDirs: {
      id: 120405,
      name: 'Flutter platform directories present',
      check: (ctx) => {
        if (!isFlutterProject(ctx)) return null;
        return hasProjectFile(ctx, /^android\//i) && hasProjectFile(ctx, /^ios\//i);
      },
      impact: 'medium',
      category: 'flutter',
      fix: 'Run `flutter create .` to generate `android/` and `ios/` platform directories.',
      confidence: 0.7,
    },

  flutterWebSupport: {
      id: 120406,
      name: 'Flutter web support enabled',
      check: (ctx) => {
        if (!isFlutterProject(ctx)) return null;
        return hasProjectFile(ctx, /^web\//i);
      },
      impact: 'low',
      category: 'flutter',
      fix: 'Run `flutter create --platforms=web .` to add web support.',
      confidence: 0.7,
    },

  flutterL10n: {
      id: 120407,
      name: 'Flutter localization configured',
      check: (ctx) => {
        if (!isFlutterProject(ctx)) return null;
        const pubspec = readProjectFiles(ctx, /(^|\/)pubspec\.yaml$/i);
        return hasProjectFile(ctx, /(^|\/)l10n\.yaml$/i) || /\bintl\b/i.test(pubspec);
      },
      impact: 'medium',
      category: 'flutter',
      fix: 'Add `l10n.yaml` or the `intl` package to support localization and internationalization.',
      confidence: 0.7,
    },

  flutterStateManagement: {
      id: 120408,
      name: 'Flutter state management configured',
      check: (ctx) => {
        if (!isFlutterProject(ctx)) return null;
        const pubspec = readProjectFiles(ctx, /(^|\/)pubspec\.yaml$/i);
        return /riverpod|flutter_bloc|\bbloc\b|\bprovider\b/i.test(pubspec);
      },
      impact: 'medium',
      category: 'flutter',
      fix: 'Add a state management solution such as `riverpod`, `bloc`, or `provider` to pubspec.yaml.',
      confidence: 0.7,
    },

  flutterNavigation: {
      id: 120409,
      name: 'Flutter routing configured',
      check: (ctx) => {
        if (!isFlutterProject(ctx)) return null;
        const pubspec = readProjectFiles(ctx, /(^|\/)pubspec\.yaml$/i);
        return /go_router|auto_route/i.test(pubspec);
      },
      impact: 'medium',
      category: 'flutter',
      fix: 'Add `go_router` or `auto_route` for declarative, type-safe Flutter routing.',
      confidence: 0.7,
    },

  flutterCIConfigured: {
      id: 120410,
      name: 'CI runs flutter test',
      check: (ctx) => {
        if (!isFlutterProject(ctx)) return null;
        return /flutter test(\s|$)/i.test(getWorkflowContent(ctx));
      },
      impact: 'high',
      category: 'flutter',
      fix: 'Add `flutter test` to your CI workflow so tests run automatically on every change.',
      confidence: 0.8,
    },

  flutterCodeGen: {
      id: 120411,
      name: 'Flutter code generation configured',
      check: (ctx) => {
        if (!isFlutterProject(ctx)) return null;
        const pubspec = readProjectFiles(ctx, /(^|\/)pubspec\.yaml$/i);
        return /build_runner|freezed/i.test(pubspec);
      },
      impact: 'medium',
      category: 'flutter',
      fix: 'Add `build_runner` and/or `freezed` to pubspec.yaml for code generation support.',
      confidence: 0.7,
    },

  flutterFirebase: {
      id: 120412,
      name: 'Flutter Firebase integration',
      check: (ctx) => {
        if (!isFlutterProject(ctx)) return null;
        const pubspec = readProjectFiles(ctx, /(^|\/)pubspec\.yaml$/i);
        return /firebase/i.test(pubspec) || hasProjectFile(ctx, /(^|\/)firebase_options\.dart$/i);
      },
      impact: 'medium',
      category: 'flutter',
      fix: 'Add Firebase packages to pubspec.yaml and run `flutterfire configure` to generate firebase_options.dart.',
      confidence: 0.7,
    },

  flutterAssets: {
      id: 120413,
      name: 'Flutter assets configured',
      check: (ctx) => {
        if (!isFlutterProject(ctx)) return null;
        const pubspec = readProjectFiles(ctx, /(^|\/)pubspec\.yaml$/i);
        return /\bassets\s*:/i.test(pubspec);
      },
      impact: 'low',
      category: 'flutter',
      fix: 'Add an `assets:` section in pubspec.yaml to declare images, fonts, and other bundled resources.',
      confidence: 0.7,
    },

  flutterFlavors: {
      id: 120414,
      name: 'Flutter flavors configured',
      check: (ctx) => {
        if (!isFlutterProject(ctx)) return null;
        const pubspec = readProjectFiles(ctx, /(^|\/)pubspec\.yaml$/i);
        return /\bflavors?\b/i.test(pubspec) || /--flavor/i.test(getWorkflowContent(ctx));
      },
      impact: 'low',
      category: 'flutter',
      fix: 'Configure Flutter flavors for environment-specific builds (dev, staging, production).',
      confidence: 0.7,
    },

  flutterContainerized: {
      id: 120415,
      name: 'Flutter Dockerfile present',
      check: (ctx) => {
        if (!isFlutterProject(ctx)) return null;
        const dockerfiles = readProjectFiles(ctx, /(^|\/)Dockerfile/i);
        return /flutter|dart/i.test(dockerfiles);
      },
      impact: 'low',
      category: 'flutter',
      fix: 'Add a Dockerfile that includes the Flutter or Dart SDK for containerized builds.',
      confidence: 0.7,
    },

  swiftPackageExists: {
      id: 120501,
      name: 'Swift package or Xcode project exists',
      check: (ctx) => {
        if (!isSwiftProject(ctx)) return null;
        return true;
      },
      impact: 'high',
      category: 'swift',
      fix: 'Add a `Package.swift` or `.xcodeproj` to define your Swift project structure.',
      confidence: 0.7,
    },

  swiftLinter: {
      id: 120502,
      name: 'SwiftLint configured',
      check: (ctx) => {
        if (!isSwiftProject(ctx)) return null;
        return hasProjectFile(ctx, /(^|\/)(\.swiftlint\.yml|\.swiftlint\.yaml)$/i);
      },
      impact: 'medium',
      category: 'swift',
      fix: 'Add `.swiftlint.yml` to enforce Swift coding conventions.',
      confidence: 0.8,
    },

  swiftTests: {
      id: 120503,
      name: 'Swift tests exist',
      check: (ctx) => {
        if (!isSwiftProject(ctx)) return null;
        return hasProjectFile(ctx, /(^|\/)Tests\//i) ||
          findProjectFiles(ctx, /\.swift$/i).some(f => /XCTest/i.test(ctx.fileContent(f) || ''));
      },
      impact: 'high',
      category: 'swift',
      fix: 'Add Swift tests in a `Tests/` directory using XCTest.',
      confidence: 0.8,
    },

  swiftFormatter: {
      id: 120504,
      name: 'SwiftFormat configured',
      check: (ctx) => {
        if (!isSwiftProject(ctx)) return null;
        return hasProjectFile(ctx, /(^|\/)\.swiftformat$/i);
      },
      impact: 'medium',
      category: 'swift',
      fix: 'Add `.swiftformat` to enforce consistent Swift formatting.',
      confidence: 0.7,
    },

  swiftCIConfigured: {
      id: 120505,
      name: 'CI runs swift test or xcodebuild',
      check: (ctx) => {
        if (!isSwiftProject(ctx)) return null;
        return /swift test|xcodebuild(\s|$)/i.test(getWorkflowContent(ctx));
      },
      impact: 'high',
      category: 'swift',
      fix: 'Add `swift test` or `xcodebuild test` to your CI workflow.',
      confidence: 0.8,
    },

  swiftDocComments: {
      id: 120506,
      name: 'Swift doc comments present',
      check: (ctx) => {
        if (!isSwiftProject(ctx)) return null;
        const swiftFiles = findProjectFiles(ctx, /\.swift$/i);
        if (swiftFiles.length === 0) return null;
        return swiftFiles.some(f => /\/\/\//.test(ctx.fileContent(f) || ''));
      },
      impact: 'low',
      category: 'swift',
      fix: 'Add `///` documentation comments to public Swift APIs.',
      confidence: 0.7,
    },

  swiftSPM: {
      id: 120507,
      name: 'Swift Package Manager used',
      check: (ctx) => {
        if (!isSwiftProject(ctx)) return null;
        return hasProjectFile(ctx, /(^|\/)Package\.swift$/i);
      },
      impact: 'medium',
      category: 'swift',
      fix: 'Add `Package.swift` to use Swift Package Manager for dependency management.',
      confidence: 0.7,
    },

  swiftMinVersion: {
      id: 120508,
      name: 'Swift tools version specified',
      check: (ctx) => {
        if (!isSwiftProject(ctx)) return null;
        const pkg = readProjectFiles(ctx, /(^|\/)Package\.swift$/i);
        return /swift-tools-version/i.test(pkg);
      },
      impact: 'medium',
      category: 'swift',
      fix: 'Add `// swift-tools-version:5.9` (or appropriate version) at the top of Package.swift.',
      confidence: 0.8,
    },

  swiftAccessControl: {
      id: 120509,
      name: 'Swift access control used',
      check: (ctx) => {
        if (!isSwiftProject(ctx)) return null;
        const swiftFiles = findProjectFiles(ctx, /\.swift$/i);
        if (swiftFiles.length === 0) return null;
        return swiftFiles.some(f => /\b(public|internal)\b/.test(ctx.fileContent(f) || ''));
      },
      impact: 'low',
      category: 'swift',
      fix: 'Use `public`/`internal` access control in Swift files to define clear API boundaries.',
      confidence: 0.7,
    },

  swiftConcurrency: {
      id: 120510,
      name: 'Swift concurrency used',
      check: (ctx) => {
        if (!isSwiftProject(ctx)) return null;
        const swiftFiles = findProjectFiles(ctx, /\.swift$/i);
        if (swiftFiles.length === 0) return null;
        return swiftFiles.some(f => /\basync\b.*\bawait\b|\bawait\b/s.test(ctx.fileContent(f) || ''));
      },
      impact: 'low',
      category: 'swift',
      fix: 'Adopt Swift structured concurrency with `async`/`await` for modern asynchronous code.',
      confidence: 0.7,
    },

  kotlinGradlePlugin: {
      id: 120601,
      name: 'Kotlin Gradle plugin configured',
      check: (ctx) => {
        if (!isKotlinProject(ctx)) return null;
        const gradle = readProjectFiles(ctx, /(^|\/)(build\.gradle\.kts|build\.gradle)$/i);
        return /kotlin\(|org\.jetbrains\.kotlin/i.test(gradle);
      },
      impact: 'high',
      category: 'kotlin',
      fix: 'Apply the Kotlin Gradle plugin in build.gradle.kts to enable Kotlin compilation.',
      confidence: 0.8,
    },

  kotlinVersion: {
      id: 120602,
      name: 'Kotlin version specified',
      check: (ctx) => {
        if (!isKotlinProject(ctx)) return null;
        const gradle = readProjectFiles(ctx, /(^|\/)(build\.gradle\.kts|build\.gradle|gradle\.properties)$/i);
        return /kotlinVersion|kotlin_version|org\.jetbrains\.kotlin.*\d+\.\d+/i.test(gradle);
      },
      impact: 'high',
      category: 'kotlin',
      fix: 'Pin the Kotlin version in gradle.properties or build.gradle.kts for reproducible builds.',
      confidence: 0.8,
    },

  kotlinLinter: {
      id: 120603,
      name: 'Kotlin linter configured',
      check: (ctx) => {
        if (!isKotlinProject(ctx)) return null;
        const gradle = readProjectFiles(ctx, /(^|\/)(build\.gradle\.kts|build\.gradle)$/i);
        return /ktlint|detekt/i.test(gradle) ||
          hasProjectFile(ctx, /(^|\/)(\.editorconfig|detekt\.yml|detekt\.yaml)$/i);
      },
      impact: 'medium',
      category: 'kotlin',
      fix: 'Add `ktlint` or `detekt` to enforce Kotlin code style and static analysis.',
      confidence: 0.8,
    },

  kotlinTests: {
      id: 120604,
      name: 'Kotlin tests exist',
      check: (ctx) => {
        if (!isKotlinProject(ctx)) return null;
        return hasProjectFile(ctx, /(^|\/)src\/test\/.*\.kt$/i) ||
          hasProjectFile(ctx, /(^|\/)test\/.*\.kt$/i);
      },
      impact: 'high',
      category: 'kotlin',
      fix: 'Add Kotlin tests in `src/test/` using JUnit or KotlinTest.',
      confidence: 0.8,
    },

  kotlinCoroutines: {
      id: 120605,
      name: 'Kotlin Coroutines in dependencies',
      check: (ctx) => {
        if (!isKotlinProject(ctx)) return null;
        const gradle = readProjectFiles(ctx, /(^|\/)(build\.gradle\.kts|build\.gradle)$/i);
        return /kotlinx[.-]coroutines/i.test(gradle);
      },
      impact: 'medium',
      category: 'kotlin',
      fix: 'Add `kotlinx-coroutines-core` to dependencies for structured concurrency.',
      confidence: 0.7,
    },

  kotlinSerialization: {
      id: 120606,
      name: 'Kotlin serialization configured',
      check: (ctx) => {
        if (!isKotlinProject(ctx)) return null;
        const gradle = readProjectFiles(ctx, /(^|\/)(build\.gradle\.kts|build\.gradle)$/i);
        return /kotlinx[.-]serialization/i.test(gradle);
      },
      impact: 'medium',
      category: 'kotlin',
      fix: 'Add `kotlinx.serialization` for type-safe, multiplatform serialization.',
      confidence: 0.7,
    },

  kotlinCompose: {
      id: 120607,
      name: 'Jetpack Compose configured',
      check: (ctx) => {
        if (!isKotlinProject(ctx)) return null;
        const gradle = readProjectFiles(ctx, /(^|\/)(build\.gradle\.kts|build\.gradle)$/i);
        return /compose/i.test(gradle);
      },
      impact: 'medium',
      category: 'kotlin',
      fix: 'Enable Jetpack Compose in build.gradle.kts for modern declarative Android UI.',
      confidence: 0.7,
    },

  kotlinCIConfigured: {
      id: 120608,
      name: 'CI runs Kotlin tests',
      check: (ctx) => {
        if (!isKotlinProject(ctx)) return null;
        return /gradle.*test|gradlew.*test/i.test(getWorkflowContent(ctx));
      },
      impact: 'high',
      category: 'kotlin',
      fix: 'Add `./gradlew test` to your CI workflow so Kotlin tests run automatically.',
      confidence: 0.8,
    },

  kotlinMultiplatform: {
      id: 120609,
      name: 'Kotlin Multiplatform configured',
      check: (ctx) => {
        if (!isKotlinProject(ctx)) return null;
        const gradle = readProjectFiles(ctx, /(^|\/)(build\.gradle\.kts|build\.gradle)$/i);
        return /multiplatform/i.test(gradle);
      },
      impact: 'medium',
      category: 'kotlin',
      fix: 'Apply the `kotlin-multiplatform` Gradle plugin to share code across JVM, iOS, JS, and Native targets.',
      confidence: 0.7,
    },

  kotlinDocComments: {
      id: 120610,
      name: 'KDoc comments present',
      check: (ctx) => {
        if (!isKotlinProject(ctx)) return null;
        const ktFiles = findProjectFiles(ctx, /\.kt$/i);
        if (ktFiles.length === 0) return null;
        return ktFiles.some(f => /\/\*\*/.test(ctx.fileContent(f) || ''));
      },
      impact: 'low',
      category: 'kotlin',
      fix: 'Add KDoc comments (`/** ... */`) to public Kotlin APIs for documentation generation.',
      confidence: 0.7,
    },
};
