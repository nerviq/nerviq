const fs = require('fs');
const path = require('path');
const { buildSettingsForProfile } = require('../governance');
const { icon } = require('../output-icons');

function snapshotSettingsBeforeSetup(dir) {
  const settingsPath = path.join(dir, '.claude/settings.json');
  if (!fs.existsSync(settingsPath)) {
    return null;
  }
  try {
    return fs.readFileSync(settingsPath, 'utf8');
  } catch (_) {
    return null;
  }
}

function collectFailedSetupTemplates(ctx, techniques, only) {
  let failedWithTemplates = [];
  for (const [key, technique] of Object.entries(techniques)) {
    if (technique.passed || technique.check(ctx)) continue;
    if (!technique.template) continue;
    failedWithTemplates.push({ key, technique });
  }

  if (only && only.length > 0) {
    failedWithTemplates = failedWithTemplates.filter(item => only.includes(item.key));
  }

  return failedWithTemplates;
}

function applyTemplateResults({ dir, failedWithTemplates, stacks, ctx, templates, log }) {
  const writtenFiles = [];
  const preservedFiles = [];
  let created = 0;
  let skipped = 0;

  for (const { key, technique } of failedWithTemplates) {
    const template = templates[technique.template];
    if (!template) continue;

    const result = template(stacks, ctx);

    if (typeof result === 'string') {
      const filePathMap = {
        claudeMd: 'CLAUDE.md',
        mermaidArchitecture: 'CLAUDE.md',
      };
      if (key === 'mermaidArchitecture') continue;
      const filePath = filePathMap[key] || key;
      const fullPath = path.join(dir, filePath);

      if (!fs.existsSync(fullPath)) {
        fs.writeFileSync(fullPath, result, 'utf8');
        writtenFiles.push(filePath);
        log(`  \x1b[32m${icon('ok')}\x1b[0m Created ${filePath}`);
        created++;
      } else {
        preservedFiles.push(filePath);
        log(`  \x1b[2m${icon('skip')} Skipped ${filePath} (already exists - your version is kept)\x1b[0m`);
        skipped++;
      }
    } else if (typeof result === 'object') {
      const dirMap = {
        hooks: '.claude/hooks',
        commands: '.claude/commands',
        skills: '.claude/skills',
        rules: '.claude/rules',
        agents: '.claude/agents',
      };
      const targetDir = dirMap[technique.template] || `.claude/${technique.template}`;
      const fullDir = path.join(dir, targetDir);

      if (!fs.existsSync(fullDir)) {
        fs.mkdirSync(fullDir, { recursive: true });
      }

      for (const [fileName, content] of Object.entries(result)) {
        const filePath = path.join(fullDir, fileName);
        const fileDir = path.dirname(filePath);
        if (!fs.existsSync(fileDir)) {
          fs.mkdirSync(fileDir, { recursive: true });
        }
        if (!fs.existsSync(filePath)) {
          fs.writeFileSync(filePath, content, 'utf8');
          writtenFiles.push(path.relative(dir, filePath));
          log(`  \x1b[32m${icon('ok')}\x1b[0m Created ${path.relative(dir, filePath)}`);
          created++;
        } else {
          preservedFiles.push(path.relative(dir, filePath));
          skipped++;
        }
      }
    }
  }

  return {
    created,
    skipped,
    writtenFiles,
    preservedFiles,
  };
}

function mergeGeneratedHookSettings({ dir, profile, mcpPacks, writtenFiles, preservedFiles, log }) {
  const hooksDir = path.join(dir, '.claude/hooks');
  const settingsPath = path.join(dir, '.claude/settings.json');
  let created = 0;

  if (!fs.existsSync(hooksDir)) {
    return { created, writtenFiles, preservedFiles };
  }

  const hookFiles = fs.readdirSync(hooksDir).filter(file => file.endsWith('.sh') || file.endsWith('.js'));
  if (hookFiles.length === 0) {
    return { created, writtenFiles, preservedFiles };
  }

  const newSettings = buildSettingsForProfile({
    profileKey: profile || 'safe-write',
    hookFiles,
    mcpPackKeys: mcpPacks || [],
  });

  let existingSettings = {};
  if (fs.existsSync(settingsPath)) {
    try {
      existingSettings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    } catch (_) {
      existingSettings = {};
    }
  }

  if (newSettings.hooks) existingSettings.hooks = newSettings.hooks;
  if (newSettings.permissions) {
    existingSettings.permissions = existingSettings.permissions || {};
    const existingDeny = existingSettings.permissions.deny || [];
    const newDeny = newSettings.permissions.deny || [];
    existingSettings.permissions.deny = [...new Set([...existingDeny, ...newDeny])];
    if (!existingSettings.permissions.defaultMode && newSettings.permissions.defaultMode) {
      existingSettings.permissions.defaultMode = newSettings.permissions.defaultMode;
    }
  }
  if (newSettings.mcpServers) {
    existingSettings.mcpServers = { ...existingSettings.mcpServers, ...newSettings.mcpServers };
  }
  if (newSettings.nerviqSetup) {
    existingSettings.nerviqSetup = { ...existingSettings.nerviqSetup, ...newSettings.nerviqSetup };
  }

  fs.writeFileSync(settingsPath, JSON.stringify(existingSettings, null, 2), 'utf8');
  if (!writtenFiles.includes('.claude/settings.json') && !preservedFiles.includes('.claude/settings.json')) {
    writtenFiles.push('.claude/settings.json');
    log(`  \x1b[32m${icon('ok')}\x1b[0m Updated .claude/settings.json (hooks registered)`);
    created++;
  } else {
    log(`  \x1b[32m${icon('ok')}\x1b[0m Merged hooks into existing .claude/settings.json`);
  }

  return {
    created,
    writtenFiles,
    preservedFiles,
  };
}

module.exports = {
  applyTemplateResults,
  collectFailedSetupTemplates,
  mergeGeneratedHookSettings,
  snapshotSettingsBeforeSetup,
};
