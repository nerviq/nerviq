const fs = require('fs');
const path = require('path');
const { OpenCodeProjectContext } = require('../src/opencode/context');
const { OPENCODE_TECHNIQUES } = require('../src/opencode/techniques');
const { mkFixture, writeFile, writeJson } = require('./opencode-fixtures');

const cleanup = [];

function makeRepo(name, setup) {
  const dir = mkFixture(name);
  cleanup.push(dir);
  writeJson(dir, 'package.json', { name, private: true });
  setup(dir);
  return dir;
}

function ctxFor(name, setup) {
  return new OpenCodeProjectContext(makeRepo(name, setup));
}

function check(key, ctx) {
  return OPENCODE_TECHNIQUES[key].check(ctx);
}

afterAll(() => {
  for (const dir of cleanup) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('PP-05: config freshness accepts the current schema URL and remote config path', () => {
  const ctx = ctxFor('pp05-fresh-current', (dir) => {
    writeFile(dir, 'AGENTS.md', [
      '# OpenCode Instructions',
      '',
      '- Remote org config may be published at `.well-known/opencode`.',
    ].join('\n'));
    writeJson(dir, 'opencode.json', {
      $schema: 'https://opencode.ai/config.json',
      instructions: ['AGENTS.md'],
    });
  });

  expect(check('opencodeConfigKeysFresh', ctx)).toBe(true);
});

test('PP-05: config freshness still flags legacy .opencode/config.json guidance', () => {
  const ctx = ctxFor('pp05-fresh-stale', (dir) => {
    writeFile(dir, 'AGENTS.md', [
      '# Legacy Instructions',
      '',
      '- Store project config in `.opencode/config.json`.',
    ].join('\n'));
    writeJson(dir, 'opencode.json', {
      $schema: 'https://opencode.ai/config.json',
    });
  });

  expect(check('opencodeConfigKeysFresh', ctx)).toBe(false);
});

test('PP-05: additive-only project configs keep model explicit nullable', () => {
  const ctx = ctxFor('pp05-model-nullable', (dir) => {
    writeFile(dir, 'AGENTS.md', '# Additive Config\n');
    writeJson(dir, 'opencode.json', {
      $schema: 'https://opencode.ai/config.json',
      instructions: ['AGENTS.md'],
      mcp: {
        context7: {
          type: 'remote',
          url: 'https://mcp.context7.com/mcp',
        },
      },
    });
  });

  expect(check('opencodeModelExplicit', ctx)).toBeNull();
});

test('PP-05: nested agent model settings count as explicit model configuration', () => {
  const ctx = ctxFor('pp05-model-nested', (dir) => {
    writeFile(dir, 'AGENTS.md', '# Nested Model\n');
    writeJson(dir, 'opencode.json', {
      $schema: 'https://opencode.ai/config.json',
      agent: {
        reviewer: {
          mode: 'subagent',
          model: 'openai/gpt-5.4-mini',
          description: 'Review changes',
        },
      },
    });
  });

  expect(check('opencodeModelExplicit', ctx)).toBe(true);
});

test('PP-05: small_model is nullable when a repo does not opt into it', () => {
  const ctx = ctxFor('pp05-small-model-nullable', (dir) => {
    writeFile(dir, 'AGENTS.md', '# No Small Model\n');
    writeJson(dir, 'opencode.json', {
      $schema: 'https://opencode.ai/config.json',
      model: 'openai/gpt-5.4',
    });
  });

  expect(check('opencodeSmallModelSet', ctx)).toBeNull();
});

test('PP-05: small_model still passes when configured explicitly', () => {
  const ctx = ctxFor('pp05-small-model-set', (dir) => {
    writeFile(dir, 'AGENTS.md', '# Small Model\n');
    writeJson(dir, 'opencode.json', {
      $schema: 'https://opencode.ai/config.json',
      model: 'openai/gpt-5.4',
      small_model: 'openai/gpt-5.4-mini',
    });
  });

  expect(check('opencodeSmallModelSet', ctx)).toBe(true);
});

test('PP-05: native .opencode/skills directories are discovered', () => {
  const ctx = ctxFor('pp05-native-skills', (dir) => {
    writeFile(dir, path.join('.opencode', 'skills', 'release-helper', 'SKILL.md'), [
      '---',
      'name: release-helper',
      'description: Prepare a release.',
      '---',
      '',
      '# Release Helper',
    ].join('\n'));
  });

  expect(ctx.skillDirs()).toContain('release-helper');
  expect(ctx.skillMetadata('release-helper')).toMatch(/# Release Helper/);
});

test('PP-05: compatible .agents/skills directories are discovered', () => {
  const ctx = ctxFor('pp05-agents-skills', (dir) => {
    writeFile(dir, path.join('.agents', 'skills', 'repo-planning', 'SKILL.md'), [
      '---',
      'name: repo-planning',
      'description: Plan repo work.',
      '---',
      '',
      '# Repo Planning',
    ].join('\n'));
  });

  expect(ctx.skillDirs()).toContain('repo-planning');
  expect(check('opencodeSkillCompatPaths', ctx)).toBe(true);
});

test('PP-05: legacy .opencode/commands/<name>/SKILL.md remains compatible', () => {
  const ctx = ctxFor('pp05-legacy-command-skills', (dir) => {
    writeFile(dir, path.join('.opencode', 'commands', 'legacy-review', 'SKILL.md'), [
      '---',
      'name: legacy-review',
      'description: Backwards-compatible legacy skill path.',
      '---',
      '',
      '# Legacy Review',
    ].join('\n'));
  });

  expect(ctx.skillDirs()).toContain('legacy-review');
  expect(ctx.skillMetadata('legacy-review')).toMatch(/# Legacy Review/);
});

test('PP-05: long skill bodies do not fail bounded-description checks when frontmatter stays short', () => {
  const ctx = ctxFor('pp05-skill-body-length', (dir) => {
    writeFile(dir, path.join('.opencode', 'skills', 'deep-manual', 'SKILL.md'), [
      '---',
      'name: deep-manual',
      'description: Short summary.',
      '---',
      '',
      '# Deep Manual',
      '',
      'A'.repeat(6000),
    ].join('\n'));
  });

  expect(check('opencodeSkillDescriptionBounded', ctx)).toBe(true);
});

test('PP-05: overlong skill descriptions still fail the bounded-description rule', () => {
  const ctx = ctxFor('pp05-skill-description-length', (dir) => {
    writeFile(dir, path.join('.opencode', 'skills', 'verbose-skill', 'SKILL.md'), [
      '---',
      'name: verbose-skill',
      `description: ${'A'.repeat(3001)}`,
      '---',
      '',
      '# Verbose Skill',
    ].join('\n'));
  });

  expect(check('opencodeSkillDescriptionBounded', ctx)).toBe(false);
});

test('PP-05: propagation completeness accepts configured npm plugins plus compatible skills trees', () => {
  const ctx = ctxFor('pp05-propagation', (dir) => {
    writeFile(dir, 'AGENTS.md', [
      '# Propagation',
      '',
      '- This repo uses plugins and skills.',
    ].join('\n'));
    writeJson(dir, 'opencode.json', {
      $schema: 'https://opencode.ai/config.json',
      plugin: ['@different-ai/opencode-browser'],
    });
    writeFile(dir, path.join('.agents', 'skills', 'research', 'SKILL.md'), [
      '---',
      'name: research',
      'description: Research support.',
      '---',
      '',
      '# Research',
    ].join('\n'));
  });

  expect(check('opencodePropagationCompleteness', ctx)).toBe(true);
});
