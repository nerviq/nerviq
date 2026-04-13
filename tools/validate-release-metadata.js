#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const value = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true;
    args[key] = value;
    if (value !== true) i += 1;
  }
  return args;
}

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function readJson(filePath) {
  return JSON.parse(readText(filePath));
}

function resolveIfExists(baseDir, relativePath) {
  const candidate = path.resolve(baseDir, relativePath);
  return fs.existsSync(candidate) ? candidate : null;
}

function formatNumber(value) {
  return new Intl.NumberFormat('en-US').format(value);
}

function pushError(errors, message) {
  errors.push(message);
}

function expectIncludes({ baseDir, relativePath, snippets, label, errors }) {
  const filePath = path.join(baseDir, relativePath);
  const content = readText(filePath);
  for (const snippet of snippets) {
    if (!content.includes(snippet)) {
      pushError(errors, `${label}: expected ${relativePath} to include "${snippet}"`);
    }
  }
}

function expectJsonValue({ baseDir, relativePath, jsonPath, expected, label, errors }) {
  const filePath = path.join(baseDir, relativePath);
  const value = jsonPath.reduce((current, segment) => current && current[segment], readJson(filePath));
  if (value !== expected) {
    pushError(errors, `${label}: expected ${relativePath} -> ${jsonPath.join('.')} to be ${JSON.stringify(expected)}, got ${JSON.stringify(value)}`);
  }
}

function validateCliRepo({ rootDir, metadata, errors }) {
  const checks = formatNumber(metadata.checks);

  expectJsonValue({
    baseDir: rootDir,
    relativePath: 'package.json',
    jsonPath: ['version'],
    expected: metadata.version,
    label: 'CLI',
    errors,
  });

  const pkg = readJson(path.join(rootDir, 'package.json'));
  for (const snippet of [
    `${checks} checks`,
    `${metadata.platforms} platforms`,
    `${metadata.languages} languages`,
    `${metadata.domainPacks} domain packs`,
  ]) {
    if (!pkg.description.includes(snippet)) {
      pushError(errors, `CLI: expected package.json description to include "${snippet}"`);
    }
  }

  expectIncludes({
    baseDir: rootDir,
    relativePath: 'README.md',
    snippets: [
      `checks-${metadata.checks}-brightgreen`,
      `## ${checks} Checks Across 96 Categories`,
      `"version": "${metadata.version}"`,
      `**${checks} checks** across 8 platforms`,
    ],
    label: 'CLI',
    errors,
  });

  expectIncludes({
    baseDir: rootDir,
    relativePath: 'CHANGELOG.md',
    snippets: [
      `## [${metadata.version}] - ${metadata.releaseDate}`,
      `[Unreleased]: https://github.com/nerviq/nerviq/compare/v${metadata.version}...HEAD`,
      `[${metadata.version}]: https://github.com/nerviq/nerviq/compare/v${metadata.previousVersion}...v${metadata.version}`,
      `\`${metadata.tests}\`-test verification baseline`,
    ],
    label: 'CLI',
    errors,
  });

  expectIncludes({
    baseDir: rootDir,
    relativePath: 'SECURITY.md',
    snippets: [
      `| ${metadata.supportedCliLine} | Yes |`,
      `| < ${metadata.version.split('.').slice(0, 2).join('.')} | No |`,
    ],
    label: 'CLI',
    errors,
  });

  const securityContent = readText(path.join(rootDir, 'SECURITY.md'));
  if (securityContent.includes('| 1.0.x | Yes |')) {
    pushError(errors, 'CLI: SECURITY.md still advertises 1.0.x as supported');
  }

  expectIncludes({
    baseDir: rootDir,
    relativePath: 'action.yml',
    snippets: [`${checks} checks (~300 governance rules)`],
    label: 'CLI',
    errors,
  });

  expectIncludes({
    baseDir: rootDir,
    relativePath: 'docs/integration-contracts.md',
    snippets: [`"cliVersion": "${metadata.version}"`],
    label: 'CLI',
    errors,
  });

  expectIncludes({
    baseDir: rootDir,
    relativePath: 'docs/methodology.md',
    snippets: [
      `# How Nerviq Verifies ${checks} Checks`,
      `| Total checks | **${checks}**`,
    ],
    label: 'CLI',
    errors,
  });

  expectIncludes({
    baseDir: rootDir,
    relativePath: 'docs/why-nerviq.md',
    snippets: [`**${checks} checks** across 8 platforms`],
    label: 'CLI',
    errors,
  });

  expectIncludes({
    baseDir: rootDir,
    relativePath: 'docs/index.html',
    snippets: [
      `${checks} checks &bull; ${metadata.domainPacks} domain packs`,
      `The current research corpus backs ${checks} checks in the CLI.`,
    ],
    label: 'CLI',
    errors,
  });
}

function validateSiteRepo({ siteDir, metadata, errors }) {
  const checks = formatNumber(metadata.checks);

  expectIncludes({
    baseDir: siteDir,
    relativePath: 'src/components/terminal.tsx',
    snippets: [`nerviq v${metadata.version} — auditing project...`],
    label: 'SITE',
    errors,
  });

  expectIncludes({
    baseDir: siteDir,
    relativePath: 'src/app/page.tsx',
    snippets: [
      `{ value: "${checks}", label: "Repo checks" }`,
      `${metadata.tests} tests`,
    ],
    label: 'SITE',
    errors,
  });

  expectIncludes({
    baseDir: siteDir,
    relativePath: 'src/app/mobile/page.tsx',
    snippets: [
      `{ value: "${checks}", label: "Checks" }`,
      `${metadata.tests} tests`,
    ],
    label: 'SITE',
    errors,
  });

  expectIncludes({
    baseDir: siteDir,
    relativePath: 'src/app/checks/page.tsx',
    snippets: [`${checks} checks across ${metadata.platforms} platforms`],
    label: 'SITE',
    errors,
  });

  expectIncludes({
    baseDir: siteDir,
    relativePath: 'src/app/why/page.tsx',
    snippets: [`{ num: "${checks}", label: "Checks (8×~300 rules)" }`],
    label: 'SITE',
    errors,
  });

  expectIncludes({
    baseDir: siteDir,
    relativePath: 'src/app/docs/platforms/page.tsx',
    snippets: [`<StatCard value="${checks}" label="Checks (8 × ~300 rules)"`],
    label: 'SITE',
    errors,
  });

  expectIncludes({
    baseDir: siteDir,
    relativePath: 'src/app/docs/api/page.tsx',
    snippets: [
      `"version": "${metadata.version}"`,
      `"checks": ${metadata.checks}`,
      `<StatCard value="${metadata.checks}" label="Current checks"`,
    ],
    label: 'SITE',
    errors,
  });

  expectIncludes({
    baseDir: siteDir,
    relativePath: 'src/app/docs/integrations/page.tsx',
    snippets: [`"cliVersion": "${metadata.version}"`],
    label: 'SITE',
    errors,
  });
}

async function expectUrlIncludes({ url, snippets, label, errors }) {
  const response = await fetch(url, {
    headers: {
      'user-agent': 'nerviq-release-metadata-validator',
    },
  });
  if (!response.ok) {
    pushError(errors, `${label}: expected ${url} to return 200, got ${response.status}`);
    return;
  }
  const content = await response.text();
  for (const snippet of snippets) {
    if (!content.includes(snippet)) {
      pushError(errors, `${label}: expected ${url} to include "${snippet}"`);
    }
  }
}

async function validateSiteUrl({ siteUrl, metadata, errors }) {
  const checks = formatNumber(metadata.checks);
  const base = siteUrl.replace(/\/+$/, '');

  await expectUrlIncludes({
    url: `${base}/`,
    snippets: [
      checks,
      `${metadata.tests} tests`,
    ],
    label: 'SITE',
    errors,
  });

  await expectUrlIncludes({
    url: `${base}/mobile`,
    snippets: [
      `${metadata.tests} tests`,
      checks,
    ],
    label: 'SITE',
    errors,
  });

  await expectUrlIncludes({
    url: `${base}/docs/api`,
    snippets: [
      metadata.version,
      String(metadata.checks),
      'Current checks',
    ],
    label: 'SITE',
    errors,
  });

  await expectUrlIncludes({
    url: `${base}/docs/integrations`,
    snippets: [
      'cliVersion',
      metadata.version,
    ],
    label: 'SITE',
    errors,
  });
}

function validateResearchRepo({ researchDir, metadata, errors }) {
  const checks = formatNumber(metadata.checks);

  expectJsonValue({
    baseDir: researchDir,
    relativePath: 'nerviq-state.json',
    jsonPath: ['cli_version'],
    expected: metadata.version,
    label: 'RESEARCH',
    errors,
  });

  expectJsonValue({
    baseDir: researchDir,
    relativePath: 'nerviq-state.json',
    jsonPath: ['cli_checks'],
    expected: metadata.checks,
    label: 'RESEARCH',
    errors,
  });

  expectIncludes({
    baseDir: researchDir,
    relativePath: 'CLAUDE.md',
    snippets: [
      `**NERVIQ CLI v${metadata.version}** | ${checks} checks | ${metadata.platforms} platforms | ${metadata.tests} tests`,
    ],
    label: 'RESEARCH',
    errors,
  });

  expectIncludes({
    baseDir: researchDir,
    relativePath: 'research/nerviq-micro-workplan-2026-04-05.md',
    snippets: [
      `**Current product state:** @nerviq/cli v${metadata.version} | ${checks} checks | ${metadata.platforms} platforms | ${metadata.languages} languages | ${metadata.domainPacks} domain packs | ${metadata.tests} tests`,
    ],
    label: 'RESEARCH',
    errors,
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rootDir = process.cwd();
  const metadata = readJson(path.join(rootDir, 'release-metadata.json'));
  const errors = [];

  validateCliRepo({ rootDir, metadata, errors });

  // Prefer `-main` worktrees when present. The maintainer's convention is to
  // keep the main-branch worktree at `<repo>-main` and use a sibling
  // `<repo>` directory for parallel agent feature branches. The drift guard
  // must validate against the main-branch worktree, not a stale feature
  // branch, or `npm publish` will refuse a fully-synced release.
  const siteDir = args.site === true
    ? null
    : (args.site
        ? path.resolve(rootDir, args.site)
        : resolveIfExists(rootDir, '../nerviq-site-main') || resolveIfExists(rootDir, '../nerviq-site'));
  const researchDir = args.research === true
    ? null
    : (args.research
        ? path.resolve(rootDir, args.research)
        : resolveIfExists(rootDir, '../nerviq-research-main') || resolveIfExists(rootDir, '../nerviq-research'));

  if (siteDir) {
    validateSiteRepo({ siteDir, metadata, errors });
  } else if (args['site-url'] && args['site-url'] !== true) {
    await validateSiteUrl({ siteUrl: args['site-url'], metadata, errors });
  } else {
    console.log('release-metadata: site repo not provided; skipping cross-repo site validation');
  }

  if (researchDir) {
    validateResearchRepo({ researchDir, metadata, errors });
  } else {
    console.log('release-metadata: research repo not provided; skipping cross-repo research validation');
  }

  if (errors.length > 0) {
    console.error('release-metadata validation failed:\n');
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  console.log(`release-metadata validation passed for v${metadata.version}`);
}

main().catch((error) => {
  console.error(error.stack || String(error));
  process.exit(1);
});
