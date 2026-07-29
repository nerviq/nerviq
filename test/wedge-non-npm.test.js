/**
 * WEDGE-01 — stale-reference detection outside the npm ecosystem.
 *
 * Until 2026-07-29 the headline "your agent docs lie" wedge only read
 * package.json, so every Python / Go / Rust / Ruby / PHP repo scanned clean
 * by default. These tests pin the two patterns that close that gap and, just
 * as importantly, pin the false-positive guards: a wrong finding in this
 * layer is worse than no finding at all.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { ProjectContext } = require('../src/context');
const { runShallowRisk } = require('../src/shallow-risk');

const TASK_KEY = 'agent-config-task-not-in-runner';
const VERSION_KEY = 'agent-config-toolchain-version-mismatch';

function mkFixture(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `nerviq-wedge-${name}-`));
}

function writeFile(dir, relPath, content) {
  const fullPath = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  const output = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
  fs.writeFileSync(fullPath, output, 'utf8');
}

function findingsFor(dir, key) {
  return runShallowRisk(new ProjectContext(dir)).filter((item) => item.key === key);
}

function withFixture(name, build, assert) {
  const dir = mkFixture(name);
  try {
    build(dir);
    assert(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('WEDGE-01 task runners (agent-config-task-not-in-runner)', () => {
  test('flags a Makefile target the agent doc invents', () => {
    withFixture('make-positive', (dir) => {
      writeFile(dir, 'Makefile', '.PHONY: test\ntest:\n\tpytest -q\n');
      writeFile(dir, 'CLAUDE.md', '# App\nRun `make test` then `make coverage`.\n');
    }, (dir) => {
      const findings = findingsFor(dir, TASK_KEY);
      expect(findings).toHaveLength(1);
      expect(findings[0].severity).toBe('high');
      expect(findings[0].file).toBe('CLAUDE.md');
      expect(findings[0].line).toBe(2);
      expect(findings[0].fix).toContain('`make coverage`');
    });
  });

  test('honours .PHONY declarations as target sources', () => {
    withFixture('make-phony', (dir) => {
      writeFile(dir, 'Makefile', '.PHONY: lint fmt\nlint:\n\truff check .\n');
      writeFile(dir, 'CLAUDE.md', 'Run `make fmt` to format.\n');
    }, (dir) => {
      expect(findingsFor(dir, TASK_KEY)).toEqual([]);
    });
  });

  test('does not read prose as an invocation ("make sure", "just run it")', () => {
    withFixture('make-prose', (dir) => {
      writeFile(dir, 'Makefile', 'test:\n\tpytest\n');
      writeFile(dir, 'CLAUDE.md', 'Make sure the suite is green. Just verify locally first.\n');
    }, (dir) => {
      expect(findingsFor(dir, TASK_KEY)).toEqual([]);
    });
  });

  test('stays silent when the repo has no task runner at all', () => {
    withFixture('no-runner', (dir) => {
      writeFile(dir, 'CLAUDE.md', 'Run `make deploy` on release day.\n');
    }, (dir) => {
      expect(findingsFor(dir, TASK_KEY)).toEqual([]);
    });
  });

  test('flags an undeclared justfile recipe', () => {
    withFixture('just', (dir) => {
      writeFile(dir, 'justfile', 'build:\n  cargo build\n');
      writeFile(dir, 'CLAUDE.md', 'Use `just build` and `just release`.\n');
    }, (dir) => {
      const findings = findingsFor(dir, TASK_KEY);
      expect(findings).toHaveLength(1);
      expect(findings[0].fix).toContain('`just release`');
    });
  });

  test('flags an undeclared Taskfile task', () => {
    withFixture('taskfile', (dir) => {
      writeFile(dir, 'Taskfile.yml', "version: '3'\ntasks:\n  build:\n    cmds: [go build ./...]\n");
      writeFile(dir, 'AGENTS.md', 'Use `task build` and `task e2e`.\n');
    }, (dir) => {
      const findings = findingsFor(dir, TASK_KEY);
      expect(findings).toHaveLength(1);
      expect(findings[0].fix).toContain('`task e2e`');
    });
  });

  test('flags an undeclared composer script but not composer built-ins', () => {
    withFixture('composer', (dir) => {
      writeFile(dir, 'composer.json', { require: {}, scripts: { test: 'phpunit' } });
      writeFile(dir, 'AGENTS.md', 'Run `composer install`, then `composer test`, then `composer lint`.\n');
    }, (dir) => {
      const findings = findingsFor(dir, TASK_KEY);
      expect(findings).toHaveLength(1);
      expect(findings[0].fix).toContain('`composer lint`');
    });
  });

  test('flags rake tasks but skips namespaced ones injected by gems', () => {
    withFixture('rake', (dir) => {
      writeFile(dir, 'Rakefile', 'task :spec do\n  sh "rspec"\nend\n');
      writeFile(dir, 'CLAUDE.md', 'Run `rake spec`, `rake seed`, and `rake db:migrate`.\n');
    }, (dir) => {
      const findings = findingsFor(dir, TASK_KEY);
      expect(findings).toHaveLength(1);
      expect(findings[0].fix).toContain('`rake seed`');
    });
  });

  test('reads bundle exec rake without requiring backticks', () => {
    withFixture('rake-bundle', (dir) => {
      writeFile(dir, 'Rakefile', 'task :spec do\nend\n');
      writeFile(dir, 'CLAUDE.md', 'Before deploy, run bundle exec rake audit.\n');
    }, (dir) => {
      expect(findingsFor(dir, TASK_KEY)).toHaveLength(1);
    });
  });

  test('flags an undeclared tox environment', () => {
    withFixture('tox', (dir) => {
      writeFile(dir, 'tox.ini', '[tox]\nenvlist = py312\n[testenv:lint]\ncommands = ruff check .\n');
      writeFile(dir, 'CLAUDE.md', 'Run `tox -e lint` and `tox -e docs`.\n');
    }, (dir) => {
      const findings = findingsFor(dir, TASK_KEY);
      expect(findings).toHaveLength(1);
      expect(findings[0].fix).toContain('testenv:docs');
    });
  });

  test('flags an undeclared cargo-make task', () => {
    withFixture('cargo-make', (dir) => {
      writeFile(dir, 'Makefile.toml', '[tasks.ci]\ncommand = "cargo"\n');
      writeFile(dir, 'CLAUDE.md', 'Run cargo make ci, then cargo make release.\n');
    }, (dir) => {
      const findings = findingsFor(dir, TASK_KEY);
      expect(findings).toHaveLength(1);
      expect(findings[0].fix).toContain('tasks.release');
    });
  });

  test('never flags a task the doc itself discloses as missing', () => {
    withFixture('disclaimer', (dir) => {
      writeFile(dir, 'Makefile', 'test:\n\tpytest\n');
      writeFile(dir, 'CLAUDE.md', 'This repo does not define `make bench` — do not pretend it exists.\n');
    }, (dir) => {
      expect(findingsFor(dir, TASK_KEY)).toEqual([]);
    });
  });

  test('a disclaimer on the NEXT line does not swallow a real finding', () => {
    withFixture('disclaimer-order', (dir) => {
      writeFile(dir, 'Makefile', 'test:\n\tpytest\n');
      writeFile(dir, 'CLAUDE.md', 'Run `make coverage` for coverage.\nNote: this repo does not define `make bench`.\n');
    }, (dir) => {
      const findings = findingsFor(dir, TASK_KEY);
      expect(findings).toHaveLength(1);
      expect(findings[0].fix).toContain('`make coverage`');
    });
  });
});

describe('WEDGE-01 toolchain versions (agent-config-toolchain-version-mismatch)', () => {
  test('flags a stale Go minor version from go.mod', () => {
    withFixture('go', (dir) => {
      writeFile(dir, 'go.mod', 'module demo\n\ngo 1.23\n');
      writeFile(dir, 'AGENTS.md', 'Go 1.21 service. Make sure tests pass before you commit.\n');
    }, (dir) => {
      const findings = findingsFor(dir, VERSION_KEY);
      expect(findings).toHaveLength(1);
      expect(findings[0].fix).toContain('go.mod');
      expect(findings[0].fix).toContain('1.23');
    });
  });

  test('flags stale Python and Django versions from pyproject inline arrays', () => {
    withFixture('python', (dir) => {
      writeFile(dir, 'pyproject.toml', '[project]\nrequires-python = ">=3.12"\ndependencies = ["django>=5.1"]\n');
      writeFile(dir, 'CLAUDE.md', 'A Python 3.10 project.\nBuilt on Django 4.\n');
    }, (dir) => {
      const labels = findingsFor(dir, VERSION_KEY).map((f) => f.fix).join(' ');
      expect(labels).toContain('Python 3.10');
      expect(labels).toContain('Django 4');
    });
  });

  test('flags stale Ruby and Rails versions from the Gemfile', () => {
    withFixture('ruby', (dir) => {
      writeFile(dir, 'Gemfile', 'source "https://rubygems.org"\nruby "3.3.0"\ngem "rails", "~> 7.2"\n');
      writeFile(dir, 'CLAUDE.md', 'Rails 6 app.\nRuns on Ruby 3.1.\n');
    }, (dir) => {
      expect(findingsFor(dir, VERSION_KEY)).toHaveLength(2);
    });
  });

  test('flags stale PHP and Laravel versions from composer.json', () => {
    withFixture('php', (dir) => {
      writeFile(dir, 'composer.json', { require: { php: '^8.3', 'laravel/framework': '^11.0' } });
      writeFile(dir, 'AGENTS.md', 'Laravel 10 site.\nTargets PHP 8.1.\n');
    }, (dir) => {
      expect(findingsFor(dir, VERSION_KEY)).toHaveLength(2);
    });
  });

  test('flags a stale Rust edition from Cargo.toml', () => {
    withFixture('rust', (dir) => {
      writeFile(dir, 'Cargo.toml', '[package]\nname = "demo"\nedition = "2021"\n');
      writeFile(dir, 'CLAUDE.md', 'Crate uses edition 2018.\n');
    }, (dir) => {
      expect(findingsFor(dir, VERSION_KEY)).toHaveLength(1);
    });
  });

  test('flags a stale Node major from .nvmrc', () => {
    withFixture('node', (dir) => {
      writeFile(dir, '.nvmrc', '22\n');
      writeFile(dir, 'CLAUDE.md', 'Requires Node 18 or later.\n');
    }, (dir) => {
      expect(findingsFor(dir, VERSION_KEY)).toHaveLength(1);
    });
  });

  test('stays quiet on migration notes, supported-version lists and the correct version', () => {
    withFixture('version-negatives', (dir) => {
      writeFile(dir, 'go.mod', 'module ok\n\ngo 1.23\n');
      writeFile(dir, 'CLAUDE.md', [
        'Go 1.23 service.',
        'We upgraded from Go 1.19 last year.',
        'Migration note: Go 1.20 was skipped.',
        'Supported: Go 1.22 and Go 1.23 both build.',
        'The toolchain does not target Go 1.18.',
      ].join('\n'));
    }, (dir) => {
      expect(findingsFor(dir, VERSION_KEY)).toEqual([]);
    });
  });

  test('does not confuse similarly named dependencies', () => {
    withFixture('version-similar-dep', (dir) => {
      writeFile(dir, 'requirements.txt', 'django-extensions==3.2.0\ndjangorestframework==3.15.0\n');
      writeFile(dir, 'CLAUDE.md', 'Uses Django 5 conventions.\n');
    }, (dir) => {
      expect(findingsFor(dir, VERSION_KEY)).toEqual([]);
    });
  });
});
