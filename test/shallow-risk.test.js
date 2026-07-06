const fs = require('fs');
const os = require('os');
const path = require('path');
const { ProjectContext } = require('../src/context');
const { runShallowRisk } = require('../src/shallow-risk');

function mkFixture(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `nerviq-shallow-risk-${name}-`));
}

function writeFile(dir, relPath, content) {
  const fullPath = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  const output = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
  fs.writeFileSync(fullPath, output, 'utf8');
}

function runFixture(dir, key) {
  const findings = runShallowRisk(new ProjectContext(dir)).filter((item) => item.key === key);
  return findings;
}

describe('CTO-06 shallow-risk patterns', () => {
  test('agent-config-missing-file emits a high-severity hint with file evidence', () => {
    const dir = mkFixture('missing-file-positive');
    try {
      writeFile(dir, 'CLAUDE.md', '# Project\nSee docs/SECURITY.md for the security model.\n');
      const [finding] = runFixture(dir, 'agent-config-missing-file');
      expect(finding).toBeTruthy();
      expect(finding.severity).toBe('high');
      expect(finding.file).toBe('CLAUDE.md');
      expect(finding.line).toBe(2);
      expect(finding.layer).toBe('shallow-risk');
      expect(finding.snippet).toContain('docs/SECURITY.md');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('agent-config-missing-file skips well-known convention references', () => {
    const dir = mkFixture('missing-file-negative');
    try {
      writeFile(dir, 'CLAUDE.md', '# Project\nSee .github/CODEOWNERS before requesting review.\n');
      expect(runFixture(dir, 'agent-config-missing-file')).toEqual([]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('agent-config-missing-file resolves repo-root files from nested Claude command docs', () => {
    const dir = mkFixture('missing-file-root-justfile');
    try {
      writeFile(dir, '.claude/commands/release/release.md', 'Run `justfile` before cutting the release.\n');
      writeFile(dir, 'justfile', 'release:\n\techo ok\n');
      expect(runFixture(dir, 'agent-config-missing-file')).toEqual([]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('agent-config-missing-file resolves repo-root .github files from nested skill docs', () => {
    const dir = mkFixture('missing-file-root-github');
    try {
      writeFile(dir, '.claude/skills/pre-push-review/SKILL.md', 'Review `.github/workflows/bots.yml` before shipping.\n');
      writeFile(dir, '.github/workflows/bots.yml', 'name: bots\n');
      expect(runFixture(dir, 'agent-config-missing-file')).toEqual([]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('agent-config-missing-file follows markdown link targets instead of link labels', () => {
    const dir = mkFixture('missing-file-markdown-target');
    try {
      writeFile(dir, '.cursor/rules/project-design.mdc', 'Review [valuation.rb](mdc:app/models/valuation.rb) before editing the flow.\n');
      writeFile(dir, 'app/models/valuation.rb', 'class Valuation; end\n');
      expect(runFixture(dir, 'agent-config-missing-file')).toEqual([]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('agent-config-missing-file treats ./ root docs in nested agent files as repo-root references', () => {
    const dir = mkFixture('missing-file-root-dot-slash');
    try {
      writeFile(dir, '.windsurf/rules/project-structure.md', 'See `./CONTRIBUTING.md` for the full workflow.\n');
      writeFile(dir, 'CONTRIBUTING.md', '# Contributing\n');
      expect(runFixture(dir, 'agent-config-missing-file')).toEqual([]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('agent-config-missing-file skips HTML comment template examples', () => {
    const dir = mkFixture('missing-file-html-comment');
    try {
      writeFile(dir, '.codex/skills/planning-with-files/templates/progress.md', '<!--\nEXAMPLE:\n- Created todo.py with basic structure\n-->\n');
      expect(runFixture(dir, 'agent-config-missing-file')).toEqual([]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('agent-config-missing-file skips inline example lines with e.g markers', () => {
    const dir = mkFixture('missing-file-eg-line');
    try {
      writeFile(dir, '.windsurf/rules/testing.md', 'Co-locate tests with source files (e.g., `foo.service.ts` and `foo.service.spec.ts`).\n');
      expect(runFixture(dir, 'agent-config-missing-file')).toEqual([]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('agent-config-missing-file skips version literals that are not file paths', () => {
    const dir = mkFixture('missing-file-version-literals');
    try {
      writeFile(dir, 'AGENTS.md', 'Use Python 3.14 locally and release tag v2.33.0 when packaging.\n');
      expect(runFixture(dir, 'agent-config-missing-file')).toEqual([]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('agent-config-missing-file skips framework labels that only look file-like', () => {
    const dir = mkFixture('missing-file-framework-labels');
    try {
      writeFile(dir, 'AGENTS.md', 'Target Node.js on the backend and Next.js on the frontend.\n');
      expect(runFixture(dir, 'agent-config-missing-file')).toEqual([]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('agent-config-missing-file skips dotted API identifiers and marker names', () => {
    const dir = mkFixture('missing-file-dotted-identifiers');
    try {
      writeFile(dir, 'AGENTS.md', 'Track `pytest.mark.slow` and `repository.pullRequest.reviewThreads` when reviewing CI drift.\n');
      expect(runFixture(dir, 'agent-config-missing-file')).toEqual([]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('agent-config-missing-file skips snippet/tutorial lines that mention helper files', () => {
    const dir = mkFixture('missing-file-snippet-line');
    try {
      writeFile(dir, '.cursorrules', 'Snippet: This is a snippet of the search result. If needed, use `web_scraper.py` to scrape the page content.\n');
      expect(runFixture(dir, 'agent-config-missing-file')).toEqual([]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('agent-config-missing-file skips placeholder test path examples', () => {
    const dir = mkFixture('missing-file-placeholder-tests');
    try {
      writeFile(dir, 'CLAUDE.md', 'Run a focused test with `pytest tests/path_to_test.py::test_name -v` before you ship.\n');
      expect(runFixture(dir, 'agent-config-missing-file')).toEqual([]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('agent-config-missing-file skips env policy lines that are not required repo files', () => {
    const dir = mkFixture('missing-file-env-policy');
    try {
      writeFile(dir, 'AGENTS.md', 'Never commit secrets, API keys, or `.env` files.\n');
      expect(runFixture(dir, 'agent-config-missing-file')).toEqual([]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('agent-config-missing-file skips frontmatter metadata blocks', () => {
    const dir = mkFixture('missing-file-frontmatter');
    try {
      writeFile(dir, '.codex/skills/planning-with-files/SKILL.md', '---\nname: planning-with-files\ndescription: Creates task_plan.md, findings.md, and progress.md for long tasks.\n---\n');
      expect(runFixture(dir, 'agent-config-missing-file')).toEqual([]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('agent-config-missing-file skips markdown table rows used as examples', () => {
    const dir = mkFixture('missing-file-table-row');
    try {
      writeFile(dir, '.codex/skills/planning-with-files/reference.md', '| `task_plan.md` | phase tracking |\n| `findings.md` | discoveries |\n');
      expect(runFixture(dir, 'agent-config-missing-file')).toEqual([]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('agent-config-missing-file resolves bare filenames from scoped directory anchors on the same line', () => {
    const dir = mkFixture('missing-file-scoped-dir-anchor');
    try {
      writeFile(dir, 'AGENTS.md', '- `/api` - FastAPI endpoints + `container.py` composition root.\n');
      writeFile(dir, 'api/container.py', 'container = object()\n');
      expect(runFixture(dir, 'agent-config-missing-file')).toEqual([]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('agent-config-missing-file resolves bare filenames from explicit file anchors on the same line', () => {
    const dir = mkFixture('missing-file-explicit-file-anchor');
    try {
      writeFile(dir, 'AGENTS.md', '`src/agents/run.py` is the runtime entrypoint. Keep new helpers out of `run.py`.\n');
      writeFile(dir, 'src/agents/run.py', 'def run():\n    return None\n');
      expect(runFixture(dir, 'agent-config-missing-file')).toEqual([]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('agent-config-missing-file resolves scoped suffix paths from anchored directories', () => {
    const dir = mkFixture('missing-file-suffix-anchor');
    try {
      writeFile(dir, 'AGENTS.md', 'Keep runtime helpers under `src/agents/run_internal/` and mirror changes in `run_internal/run_loop.py`.\n');
      writeFile(dir, 'src/agents/run_internal/run_loop.py', 'def run_loop():\n    return None\n');
      expect(runFixture(dir, 'agent-config-missing-file')).toEqual([]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('agent-config-missing-file resolves bare filenames from markdown link targets on the same line', () => {
    const dir = mkFixture('missing-file-markdown-link-anchor');
    try {
      writeFile(dir, '.codex/skills/planning-with-files/SKILL.md', 'Create `task_plan.md` and use [templates/task_plan.md](templates/task_plan.md) as reference.\n');
      writeFile(dir, '.codex/skills/planning-with-files/templates/task_plan.md', '# Task plan\n');
      expect(runFixture(dir, 'agent-config-missing-file')).toEqual([]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('agent-config-missing-file treats planning scratch basenames as scoped artifacts when they exist in repo', () => {
    const dir = mkFixture('missing-file-task-plan-artifact');
    try {
      writeFile(dir, '.codex/skills/planning-with-files/SKILL.md', 'Never start a complex task without `task_plan.md`.\n');
      writeFile(dir, 'templates/task_plan.md', '# Task plan\n');
      expect(runFixture(dir, 'agent-config-missing-file')).toEqual([]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('agent-config-missing-file resolves scoped ownership references when the basename exists elsewhere in repo', () => {
    const dir = mkFixture('missing-file-owned-basename');
    try {
      writeFile(dir, 'CLAUDE.md', 'When copyright notices change, update that subdirectory\'s `CHANGELOG.md` file.\n');
      writeFile(dir, 'docs/CHANGELOG.md', '# Docs changelog\n');
      expect(runFixture(dir, 'agent-config-missing-file')).toEqual([]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('agent-config-missing-file resolves integration-folder basenames under scoped anchors', () => {
    const dir = mkFixture('missing-file-integration-anchor');
    try {
      writeFile(dir, '.claude/skills/integrations/SKILL.md', 'Check `homeassistant/components/<integration domain>` and inspect `manifest.json` plus `quality_scale.yaml`.\n');
      writeFile(dir, 'homeassistant/components/demo/manifest.json', '{\"domain\":\"demo\"}\n');
      writeFile(dir, 'homeassistant/components/demo/quality_scale.yaml', 'rules: []\n');
      expect(runFixture(dir, 'agent-config-missing-file')).toEqual([]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('agent-config-missing-file skips disposable plan references in guidance text', () => {
    const dir = mkFixture('missing-file-disposable-plan');
    try {
      writeFile(dir, 'AGENTS.md', 'If an issue already exists, submit a PR with just a `PLAN.md` file that can be deleted afterwards.\n');
      expect(runFixture(dir, 'agent-config-missing-file')).toEqual([]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('agent-config-missing-file still flags real repo-root misses from nested docs', () => {
    const dir = mkFixture('missing-file-root-miss');
    try {
      writeFile(dir, '.claude/commands/release/release.md', 'Inspect `src/cli/next-dev.ts` before cutting the release.\n');
      const [finding] = runFixture(dir, 'agent-config-missing-file');
      expect(finding).toBeTruthy();
      expect(finding.fix).toContain('`src/cli/next-dev.ts`');
      expect(finding.file).toBe('.claude/commands/release/release.md');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('agent-config-script-not-in-package-json flags a missing script referenced via npm run', () => {
    const dir = mkFixture('script-missing-positive');
    try {
      writeFile(dir, 'package.json', { name: 'x', version: '1.0.0', scripts: { test: 'echo ok' } });
      writeFile(dir, 'CLAUDE.md', '# Project\nAlways run `npm run deploy:prod` before merging.\n');
      const [finding] = runFixture(dir, 'agent-config-script-not-in-package-json');
      expect(finding).toBeTruthy();
      expect(finding.fix).toContain('deploy:prod');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('agent-config-script-not-in-package-json skips prose like "npm package" (v1.31 FP)', () => {
    const dir = mkFixture('script-missing-prose-fp');
    try {
      writeFile(dir, 'package.json', { name: 'x', version: '1.0.0', scripts: { test: 'echo ok' } });
      // The exact FP shape: bare `npm <noun>` in a table/prose is not a
      // script invocation — npm has no bare-script shorthand.
      writeFile(dir, 'AGENTS.md', '# Repo map\n| repo | Shipped CLI / npm package / Action | path |\nThis project ships as an npm package for distribution.\n');
      expect(runFixture(dir, 'agent-config-script-not-in-package-json')).toEqual([]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('agent-config-script-not-in-package-json flags yarn shorthand only when written as code', () => {
    const dir = mkFixture('script-missing-shorthand');
    try {
      writeFile(dir, 'package.json', { name: 'x', version: '1.0.0', scripts: { test: 'echo ok' } });
      writeFile(dir, 'CLAUDE.md', '# Project\nUse the yarn workspace layout for packages.\nBuild with `yarn compile` before testing.\n');
      const findings = runFixture(dir, 'agent-config-script-not-in-package-json');
      expect(findings).toHaveLength(1);
      expect(findings[0].fix).toContain('compile');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('agent-config-script-not-in-package-json skips single-line "do NOT exist" corrective notes', () => {
    const dir = mkFixture('script-missing-disclaimer-single');
    try {
      writeFile(dir, 'package.json', { name: 'x', version: '1.0.0', scripts: { build: 'next build' } });
      writeFile(dir, 'CLAUDE.md', "# Project\nNote: `npm test`, `npm run lint`, `npm run typecheck` do NOT exist in this repo's `package.json`. Rely on `npm run build`.\n");
      expect(runFixture(dir, 'agent-config-script-not-in-package-json')).toEqual([]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('agent-config-script-not-in-package-json skips corrective notes that wrap across two lines', () => {
    const dir = mkFixture('script-missing-disclaimer-wrapped');
    try {
      writeFile(dir, 'package.json', { name: 'x', version: '1.0.0', scripts: { build: 'next build' } });
      writeFile(dir, 'AGENTS.md', '# Repo\n**Note:** the site `package.json` does\nNOT define `npm test`, `npm run lint`, or `npm run typecheck`. Use the build.\n');
      expect(runFixture(dir, 'agent-config-script-not-in-package-json')).toEqual([]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('agent-config-stack-contradiction fires only when the declared stack has zero evidence', () => {
    const dir = mkFixture('stack-contradiction-positive');
    try {
      writeFile(dir, 'CLAUDE.md', 'Primary language: Go\n');
      writeFile(dir, 'pyproject.toml', '[project]\nname = "demo"\n');
      const [finding] = runFixture(dir, 'agent-config-stack-contradiction');
      expect(finding).toBeTruthy();
      expect(finding.severity).toBe('high');
      expect(finding.file).toBe('CLAUDE.md');
      expect(finding.line).toBe(1);
      expect(finding.layer).toBe('shallow-risk');
      expect(finding.snippet).toContain('Primary language: Go');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('agent-config-stack-contradiction skips repos where the declared stack actually exists', () => {
    const dir = mkFixture('stack-contradiction-negative');
    try {
      writeFile(dir, 'CLAUDE.md', 'Primary language: Go\n');
      writeFile(dir, 'go.mod', 'module example.com/demo\n');
      writeFile(dir, 'pyproject.toml', '[project]\nname = "demo"\n');
      expect(runFixture(dir, 'agent-config-stack-contradiction')).toEqual([]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('agent-config-cross-platform-drift reports contradictory platform claims', () => {
    const dir = mkFixture('cross-platform-drift-positive');
    try {
      writeFile(dir, 'CLAUDE.md', 'This is a pure JavaScript project.\n');
      writeFile(dir, '.cursor/rules/main.mdc', 'Use TypeScript strict mode.\n');
      const [finding] = runFixture(dir, 'agent-config-cross-platform-drift');
      expect(finding).toBeTruthy();
      expect(finding.severity).toBe('high');
      expect(finding.file).toBe('.cursor/rules/main.mdc');
      expect(finding.line).toBe(1);
      expect(finding.layer).toBe('shallow-risk');
      expect(finding.snippet).toContain('TypeScript');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('agent-config-cross-platform-drift skips when the second platform file is empty', () => {
    const dir = mkFixture('cross-platform-drift-negative');
    try {
      writeFile(dir, 'CLAUDE.md', 'This is a pure JavaScript project.\n');
      writeFile(dir, '.cursor/rules/main.mdc', '\n');
      expect(runFixture(dir, 'agent-config-cross-platform-drift')).toEqual([]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('mcp-server-no-allowlist flags empty permissions as critical', () => {
    const dir = mkFixture('mcp-positive');
    try {
      writeFile(dir, '.claude/settings.json', {
        mcpServers: {
          shell: {
            command: 'node',
            args: ['./scripts/shell-mcp.js'],
            permissions: [],
          },
        },
      });
      const [finding] = runFixture(dir, 'mcp-server-no-allowlist');
      expect(finding).toBeTruthy();
      expect(finding.severity).toBe('critical');
      expect(finding.file).toBe('.claude/settings.json');
      expect(finding.layer).toBe('shallow-risk');
      expect(finding.snippet).toContain('"shell"');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('mcp-server-no-allowlist skips servers that already have an allowlist', () => {
    const dir = mkFixture('mcp-negative');
    try {
      writeFile(dir, '.claude/settings.json', {
        mcpServers: {
          shell: {
            command: 'node',
            args: ['./scripts/shell-mcp.js'],
            permissions: { allow: ['read:docs/**'] },
          },
        },
      });
      expect(runFixture(dir, 'mcp-server-no-allowlist')).toEqual([]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('hook-script-missing reports missing hook files with line evidence', () => {
    const dir = mkFixture('hook-positive');
    try {
      writeFile(dir, '.claude/settings.json', {
        hooks: {
          PreToolUse: [{
            hooks: [{
              type: 'command',
              command: '.claude/hooks/pre-commit.sh',
            }],
          }],
        },
      });
      const [finding] = runFixture(dir, 'hook-script-missing');
      expect(finding).toBeTruthy();
      expect(finding.severity).toBe('high');
      expect(finding.file).toBe('.claude/settings.json');
      expect(finding.layer).toBe('shallow-risk');
      expect(finding.snippet).toContain('.claude/hooks/pre-commit.sh');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('hook-script-missing skips inline command hooks', () => {
    const dir = mkFixture('hook-negative');
    try {
      writeFile(dir, '.claude/settings.json', {
        hooks: {
          PreToolUse: [{
            hooks: [{
              type: 'command',
              command: 'node -e "console.log(\'ok\')"',
            }],
          }],
        },
      });
      expect(runFixture(dir, 'hook-script-missing')).toEqual([]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('agent-config-secret-literal catches narrow secret shapes in agent config files', () => {
    const dir = mkFixture('secret-positive');
    try {
      const githubPat = `ghp_${'123456789012345678901234567890123456'}`;
      writeFile(dir, 'CLAUDE.md', `Use this token for the demo: ${githubPat}\n`);
      const [finding] = runFixture(dir, 'agent-config-secret-literal');
      expect(finding).toBeTruthy();
      expect(finding.severity).toBe('critical');
      expect(finding.file).toBe('CLAUDE.md');
      expect(finding.line).toBe(1);
      expect(finding.layer).toBe('shallow-risk');
      expect(finding.snippet).toContain(githubPat);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('agent-config-secret-literal skips obvious placeholders', () => {
    const dir = mkFixture('secret-negative');
    try {
      writeFile(dir, 'CLAUDE.md', 'Example AWS key: AKIAIOSFODNN7EXAMPLE\n');
      expect(runFixture(dir, 'agent-config-secret-literal')).toEqual([]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('agent-config-deprecated-keys flags deprecated Aider keys at medium severity', () => {
    const dir = mkFixture('deprecated-keys-positive');
    try {
      writeFile(dir, '.aider.conf.yml', 'auto-commit: true\n');
      const [finding] = runFixture(dir, 'agent-config-deprecated-keys');
      expect(finding).toBeTruthy();
      expect(finding.severity).toBe('medium');
      expect(finding.file).toBe('.aider.conf.yml');
      expect(finding.line).toBe(1);
      expect(finding.layer).toBe('shallow-risk');
      expect(finding.snippet).toContain('auto-commit');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('agent-config-deprecated-keys skips repos pinned to legacy Aider versions', () => {
    const dir = mkFixture('deprecated-keys-negative');
    try {
      writeFile(dir, '.aider.conf.yml', 'auto-commit: true\n');
      writeFile(dir, 'requirements.txt', 'aider-chat==0.59.0\n');
      expect(runFixture(dir, 'agent-config-deprecated-keys')).toEqual([]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('agent-config-dangerous-autoapprove always flags destructive allow rules', () => {
    const dir = mkFixture('autoapprove-positive');
    try {
      writeFile(dir, '.claude/settings.json', {
        permissions: {
          allow: ['Bash(rm -rf *)'],
        },
      });
      const [finding] = runFixture(dir, 'agent-config-dangerous-autoapprove');
      expect(finding).toBeTruthy();
      expect(finding.severity).toBe('critical');
      expect(finding.file).toBe('.claude/settings.json');
      expect(finding.layer).toBe('shallow-risk');
      expect(finding.snippet).toContain('Bash(rm -rf *)');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('agent-config-dangerous-autoapprove skips safe allow rules', () => {
    const dir = mkFixture('autoapprove-negative');
    try {
      writeFile(dir, '.claude/settings.json', {
        permissions: {
          allow: ['Bash(npm test *)'],
        },
      });
      expect(runFixture(dir, 'agent-config-dangerous-autoapprove')).toEqual([]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});
