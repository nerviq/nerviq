/**
 * Nerviq Convert
 *
 * Converts configuration files between AI coding platforms.
 * Reads the source platform's config and emits equivalent config
 * for the target platform, preserving intent where possible.
 *
 * Supported conversions:
 *   claude  → codex, cursor, copilot, gemini, windsurf, aider
 *   codex   → claude, cursor, copilot, gemini, windsurf, aider
 *   cursor  → claude, codex, copilot, gemini, windsurf, aider
 *   (any)   → (any)  using canonical model as intermediary
 */

'use strict';

const fs = require('fs');
const path = require('path');

const COLORS = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[36m',
};

function c(text, color) {
  return `${COLORS[color] || ''}${text}${COLORS.reset}`;
}

// ─── Platform config readers ─────────────────────────────────────────────────

/**
 * Read the canonical "intent" from a source platform.
 * Returns a normalized object with: name, description, rules[], mcpServers{}, hooks[]
 */
function readSourceConfig(dir, from) {
  const canonical = {
    platform: from,
    name: path.basename(dir),
    description: null,
    rules: [],         // Array of { name, content, alwaysOn, glob, description }
    mcpServers: {},    // { serverName: { command, args, env, url, type } }
    hooks: [],         // Array of { event, command, matcher }
    techStack: [],     // Detected languages/frameworks
    lintCmd: null,
    testCmd: null,
    buildCmd: null,
  };

  if (from === 'claude') {
    const claudeMd = fs.existsSync(path.join(dir, 'CLAUDE.md'))
      ? fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8')
      : null;
    if (claudeMd) {
      canonical.description = claudeMd.slice(0, 500);
      canonical.rules.push({ name: 'CLAUDE.md', content: claudeMd, alwaysOn: true });
    }
    // Read .claude/settings.json for MCP
    const settingsPath = path.join(dir, '.claude', 'settings.json');
    if (fs.existsSync(settingsPath)) {
      try {
        const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        if (settings.mcpServers) canonical.mcpServers = settings.mcpServers;
      } catch {}
    }
  }

  if (from === 'codex') {
    const agentsMd = fs.existsSync(path.join(dir, 'AGENTS.md'))
      ? fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8')
      : null;
    if (agentsMd) {
      canonical.description = agentsMd.slice(0, 500);
      canonical.rules.push({ name: 'AGENTS.md', content: agentsMd, alwaysOn: true });
    }
  }

  if (from === 'cursor') {
    const rulesDir = path.join(dir, '.cursor', 'rules');
    if (fs.existsSync(rulesDir)) {
      const files = fs.readdirSync(rulesDir).filter(f => f.endsWith('.mdc'));
      for (const file of files) {
        const content = fs.readFileSync(path.join(rulesDir, file), 'utf8');
        // Parse frontmatter
        const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
        let alwaysOn = false;
        let glob = null;
        let desc = null;
        if (fmMatch) {
          alwaysOn = /alwaysApply\s*:\s*true/i.test(fmMatch[1]);
          const globMatch = fmMatch[1].match(/globs?\s*:\s*(.+)/i);
          if (globMatch) glob = globMatch[1].trim();
          const descMatch = fmMatch[1].match(/description\s*:\s*"?([^"\n]+)"?/i);
          if (descMatch) desc = descMatch[1].trim();
        }
        canonical.rules.push({
          name: file.replace(/\.(mdc|md|txt)$/i, ''),
          content,
          alwaysOn,
          glob,
          description: desc,
        });
      }
    }
    // Cursor MCP
    const mcpPath = path.join(dir, '.cursor', 'mcp.json');
    if (fs.existsSync(mcpPath)) {
      try {
        const mcp = JSON.parse(fs.readFileSync(mcpPath, 'utf8'));
        if (mcp.mcpServers) canonical.mcpServers = mcp.mcpServers;
      } catch {}
    }
  }

  if (from === 'gemini') {
    const geminiMd = fs.existsSync(path.join(dir, 'GEMINI.md'))
      ? fs.readFileSync(path.join(dir, 'GEMINI.md'), 'utf8')
      : null;
    if (geminiMd) {
      canonical.description = geminiMd.slice(0, 500);
      canonical.rules.push({ name: 'GEMINI.md', content: geminiMd, alwaysOn: true });
    }
  }

  if (from === 'windsurf') {
    const windsurfRulesDir = path.join(dir, '.windsurf', 'rules');
    if (fs.existsSync(windsurfRulesDir)) {
      const files = fs.readdirSync(windsurfRulesDir).filter(f => f.endsWith('.md'));
      for (const file of files) {
        const content = fs.readFileSync(path.join(windsurfRulesDir, file), 'utf8');
        canonical.rules.push({ name: file.replace('.md', ''), content, alwaysOn: true });
      }
    }
  }

  if (from === 'aider') {
    const aiderConf = fs.existsSync(path.join(dir, '.aider.conf.yml'))
      ? fs.readFileSync(path.join(dir, '.aider.conf.yml'), 'utf8')
      : null;
    if (aiderConf) {
      canonical.rules.push({ name: '.aider.conf.yml', content: aiderConf, alwaysOn: false });
      const lintMatch = aiderConf.match(/lint-cmd\s*:\s*(.+)/);
      if (lintMatch) canonical.lintCmd = lintMatch[1].trim().replace(/^['"]|['"]$/g, '');
      const testMatch = aiderConf.match(/test-cmd\s*:\s*(.+)/);
      if (testMatch) canonical.testCmd = testMatch[1].trim().replace(/^['"]|['"]$/g, '');
    }
  }

  if (from === 'copilot') {
    const copilotPath = path.join(dir, '.github', 'copilot-instructions.md');
    if (fs.existsSync(copilotPath)) {
      const content = fs.readFileSync(copilotPath, 'utf8');
      canonical.rules.push({ name: 'copilot-instructions', content, alwaysOn: true });
    }
  }

  return canonical;
}

// ─── Platform config writers ─────────────────────────────────────────────────

function buildTargetOutput(canonical, to, { dryRun = false } = {}) {
  const outputs = [];  // Array of { path, content }
  // Strip MDC frontmatter from rule content for non-cursor targets to prevent leaking
  const stripFrontmatter = (text) => text.replace(/^---[\s\S]*?---\n/m, '').trim();
  const combinedContent = to === 'cursor'
    ? canonical.rules.map(r => r.content).join('\n\n')
    : canonical.rules.map(r => stripFrontmatter(r.content)).join('\n\n');

  if (to === 'claude') {
    // Extract or create CLAUDE.md from combined rules
    const content = `# ${canonical.name}\n\n${combinedContent}\n`;
    outputs.push({ file: 'CLAUDE.md', content });

    if (Object.keys(canonical.mcpServers).length > 0) {
      const settings = { mcpServers: canonical.mcpServers };
      outputs.push({ file: '.claude/settings.json', content: JSON.stringify(settings, null, 2) + '\n' });
    }
  }

  if (to === 'codex') {
    const content = `# ${canonical.name}\n\n${combinedContent}\n`;
    outputs.push({ file: 'AGENTS.md', content });
  }

  if (to === 'cursor') {
    // Write each rule as an .mdc file
    if (canonical.rules.length === 0) {
      const content = `---\nalwaysApply: true\n---\n\n# ${canonical.name}\n\n${combinedContent}\n`;
      outputs.push({ file: '.cursor/rules/core.mdc', content });
    } else {
      for (const rule of canonical.rules) {
        const fm = rule.alwaysOn
          ? `---\nalwaysApply: true\n---\n`
          : rule.glob
            ? `---\nglobs: ${rule.glob}\nalwaysApply: false\n---\n`
            : `---\nalwaysApply: false\n---\n`;
        outputs.push({ file: `.cursor/rules/${rule.name}.mdc`, content: `${fm}\n${rule.content}\n` });
      }
    }
    if (Object.keys(canonical.mcpServers).length > 0) {
      const mcp = { mcpServers: canonical.mcpServers };
      outputs.push({ file: '.cursor/mcp.json', content: JSON.stringify(mcp, null, 2) + '\n' });
    }
  }

  if (to === 'gemini') {
    const content = `# ${canonical.name}\n\n${combinedContent}\n`;
    outputs.push({ file: 'GEMINI.md', content });
    if (Object.keys(canonical.mcpServers).length > 0) {
      const settings = { mcpServers: canonical.mcpServers };
      outputs.push({ file: '.gemini/settings.json', content: JSON.stringify(settings, null, 2) + '\n' });
    }
  }

  if (to === 'windsurf') {
    if (canonical.rules.length === 0) {
      outputs.push({ file: '.windsurf/rules/core.md', content: `---\ntrigger: always_on\n---\n\n${combinedContent}\n` });
    } else {
      for (const rule of canonical.rules) {
        const fm = `---\ntrigger: always_on\n---\n`;
        const safeContent = rule.content.replace(/^---[\s\S]*?---\n/m, '').trim();
        outputs.push({ file: `.windsurf/rules/${rule.name}.md`, content: `${fm}\n${safeContent}\n` });
      }
    }
  }

  if (to === 'aider') {
    const confLines = ['# Generated by nerviq convert'];
    if (canonical.lintCmd) confLines.push(`lint-cmd: '${canonical.lintCmd}'`);
    if (canonical.testCmd) confLines.push(`test-cmd: '${canonical.testCmd}'`);
    confLines.push('auto-commits: true');
    confLines.push('auto-lint: true');
    outputs.push({ file: '.aider.conf.yml', content: confLines.join('\n') + '\n' });
    if (combinedContent.trim()) {
      outputs.push({ file: 'CONVENTIONS.md', content: `# ${canonical.name} Conventions\n\n${combinedContent}\n` });
    }
  }

  if (to === 'copilot') {
    const content = `# ${canonical.name}\n\n${combinedContent}\n`;
    outputs.push({ file: '.github/copilot-instructions.md', content });
  }

  return outputs;
}

// ─── Main convert function ────────────────────────────────────────────────────

async function runConvert({ dir = process.cwd(), from, to, dryRun = false, json = false } = {}) {
  if (!from || !to) {
    throw new Error('Both --from and --to are required. Example: nerviq convert --from claude --to codex');
  }

  const SUPPORTED = ['claude', 'codex', 'cursor', 'copilot', 'gemini', 'windsurf', 'aider', 'opencode'];
  if (!SUPPORTED.includes(from)) throw new Error(`Unsupported source platform '${from}'. Use: ${SUPPORTED.join(', ')}`);
  if (!SUPPORTED.includes(to)) throw new Error(`Unsupported target platform '${to}'. Use: ${SUPPORTED.join(', ')}`);
  if (from === to) throw new Error(`Source and target platform are the same: '${from}'`);

  const canonical = readSourceConfig(dir, from);
  const outputs = buildTargetOutput(canonical, to, { dryRun });

  const written = [];
  const skipped = [];

  if (!dryRun) {
    for (const out of outputs) {
      const outPath = path.join(dir, out.file);
      const outDir = path.dirname(outPath);
      if (!fs.existsSync(outPath)) {
        fs.mkdirSync(outDir, { recursive: true });
        fs.writeFileSync(outPath, out.content, 'utf8');
        written.push(out.file);
      } else {
        skipped.push(out.file);
      }
    }
  }

  const result = {
    from,
    to,
    dir,
    dryRun,
    sourceRulesFound: canonical.rules.length,
    mcpServersFound: Object.keys(canonical.mcpServers).length,
    outputFiles: outputs.map(o => o.file),
    written: dryRun ? [] : written,
    skipped: dryRun ? [] : skipped,
    wouldWrite: dryRun ? outputs.map(o => o.file) : [],
  };

  if (json) return JSON.stringify(result, null, 2);

  const lines = [''];
  lines.push(c(`  nerviq convert  ${from} → ${to}`, 'bold'));
  lines.push(c('  ═══════════════════════════════════════', 'dim'));
  lines.push('');
  lines.push(`  Source platform:  ${c(from, 'blue')}   (${canonical.rules.length} rule(s) found)`);
  lines.push(`  Target platform:  ${c(to, 'blue')}`);
  lines.push(`  Directory:        ${dir}`);
  lines.push(`  MCP servers:      ${Object.keys(canonical.mcpServers).length}`);
  lines.push('');

  if (dryRun) {
    lines.push(c('  Dry run — no files written', 'yellow'));
    lines.push('');
    lines.push('  Would generate:');
    for (const f of outputs) {
      lines.push(`    ${c('→', 'dim')} ${f.file}`);
    }
  } else if (written.length > 0 || skipped.length > 0) {
    if (written.length > 0) {
      lines.push('  Written:');
      for (const f of written) lines.push(`    ${c('✓', 'green')} ${f}`);
    }
    if (skipped.length > 0) {
      lines.push('  Skipped (already exists):');
      for (const f of skipped) lines.push(`    ${c('-', 'dim')} ${f}`);
    }
  }

  lines.push('');
  if (!dryRun && written.length > 0) {
    lines.push(c(`  ✓ Conversion complete. Run \`nerviq audit --platform ${to}\` to verify.`, 'green'));
  } else if (dryRun) {
    lines.push(c(`  Run without --dry-run to write files.`, 'dim'));
  } else {
    lines.push(c(`  No new files written (all already exist).`, 'dim'));
  }
  lines.push('');

  return lines.join('\n');
}

module.exports = { runConvert };
