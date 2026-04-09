/**
 * NERVIQ Technique Database
 * Curated from 1118 verified techniques, filtered to actionable setup recommendations.
 * Each technique includes: what to check, how to fix, impact level.
 */

const { attachSourceUrls, buildSupplementalChecks, CLAUDE_SUPPLEMENTAL_SOURCE_URLS, STACK_CATEGORY_DETECTORS, containsEmbeddedSecret } = require('./techniques/shared');
const instructionTechniques = require('./techniques/instructions');
const qualityTechniques = require('./techniques/quality');
const apiTechniques = require('./techniques/api');
const automationTechniques = require('./techniques/automation');
const hygieneTechniques = require('./techniques/hygiene');
const observabilityTechniques = require('./techniques/observability');
const workflowTechniques = require('./techniques/workflow');
const toolTechniques = require('./techniques/tools');
const securityTechniques = require('./techniques/security');
const complianceTechniques = require('./techniques/compliance');
const optimizationTechniques = require('./techniques/optimization');
const stackTechniques = require('./techniques/stacks');

const TECHNIQUES = Object.assign({},
  instructionTechniques,
  qualityTechniques,
  apiTechniques,
  automationTechniques,
  hygieneTechniques,
  observabilityTechniques,
  workflowTechniques,
  toolTechniques,
  securityTechniques,
  complianceTechniques,
  optimizationTechniques,
  stackTechniques,
);

Object.assign(TECHNIQUES, buildSupplementalChecks({
  idPrefix: 'CL-T',
  urlMap: CLAUDE_SUPPLEMENTAL_SOURCE_URLS,
  docs: (ctx) => [
    ctx.claudeMdContent ? ctx.claudeMdContent() : (ctx.fileContent('CLAUDE.md') || ctx.fileContent('.claude/CLAUDE.md') || ''),
    ctx.fileContent('README.md') || '',
  ].filter(Boolean).join('\n'),
}));

// Stack detection
const STACKS = {
  react: { files: ['package.json'], content: { 'package.json': 'react' }, label: 'React' },
  vue: { files: ['package.json'], content: { 'package.json': 'vue' }, label: 'Vue' },
  angular: { files: ['angular.json'], content: {}, label: 'Angular' },
  nextjs: { files: ['next.config'], content: {}, label: 'Next.js' },
  python: { files: ['requirements.txt', 'setup.py', 'pyproject.toml', 'Pipfile'], content: {}, label: 'Python' },
  django: { files: ['manage.py'], content: {}, label: 'Django' },
  fastapi: { files: ['requirements.txt'], content: { 'requirements.txt': 'fastapi' }, label: 'FastAPI' },
  node: { files: ['package.json'], content: {}, label: 'Node.js' },
  typescript: { files: ['tsconfig.json'], content: {}, label: 'TypeScript' },
  rust: { files: ['Cargo.toml'], content: {}, label: 'Rust' },
  go: { files: ['go.mod'], content: {}, label: 'Go' },
  docker: { files: ['Dockerfile', 'docker-compose.yml', 'docker-compose.yaml'], content: {}, label: 'Docker' },
  svelte: { files: ['svelte.config.js'], content: {}, label: 'Svelte' },
  flutter: { files: ['pubspec.yaml'], content: {}, label: 'Flutter' },
  ruby: { files: ['Gemfile'], content: {}, label: 'Ruby' },
  java: { files: ['pom.xml'], content: {}, label: 'Java' },
  kotlin: { files: ['build.gradle.kts'], content: {}, label: 'Kotlin' },
  swift: { files: ['Package.swift', '.xcodeproj'], content: {}, label: 'Swift' },
  terraform: { files: ['main.tf', 'terraform'], content: {}, label: 'Terraform' },
  kubernetes: { files: ['k8s', 'kubernetes', 'helm'], content: {}, label: 'Kubernetes' },
  cpp: { files: ['CMakeLists.txt', 'Makefile', '.clang-format'], content: {}, label: 'C++' },
  bazel: { files: ['BUILD', 'WORKSPACE', 'BUILD.bazel', 'WORKSPACE.bazel'], content: {}, label: 'Bazel' },
  deno: { files: ['deno.json', 'deno.jsonc', 'deno.lock'], content: {}, label: 'Deno' },
  bun: { files: ['bun.lockb', 'bunfig.toml'], content: {}, label: 'Bun' },
  elixir: { files: ['mix.exs'], content: {}, label: 'Elixir' },
  astro: { files: ['astro.config.mjs', 'astro.config.ts'], content: {}, label: 'Astro' },
  remix: { files: ['remix.config.js', 'remix.config.ts'], content: {}, label: 'Remix' },
  nestjs: { files: ['nest-cli.json'], content: {}, label: 'NestJS' },
  laravel: { files: ['artisan'], content: {}, label: 'Laravel' },
  dotnet: { files: ['global.json', 'Directory.Build.props'], content: {}, label: '.NET' },
};

attachSourceUrls('claude', TECHNIQUES);

module.exports = { TECHNIQUES, STACKS, STACK_CATEGORY_DETECTORS, containsEmbeddedSecret };
