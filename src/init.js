'use strict';

const readline = require('readline');
const { detectPlatforms } = require('./public-api');
const { audit } = require('./audit');
const { setup } = require('./setup');
const { ProjectContext } = require('./context');
const { STACKS } = require('./techniques');
const { icon } = require('./output-icons');

const PLATFORM_LABELS = {
  claude: 'Claude Code',
  codex: 'Codex',
  gemini: 'Gemini CLI',
  copilot: 'GitHub Copilot',
  cursor: 'Cursor',
  windsurf: 'Windsurf',
  aider: 'Aider',
  opencode: 'OpenCode',
};

const ALL_PLATFORMS = Object.keys(PLATFORM_LABELS);

const TEAM_SIZES = ['solo', 'small', 'team', 'enterprise'];
const TEAM_LABELS = {
  solo: 'Solo developer',
  small: 'Small team (2-5)',
  team: 'Team (6-20)',
  enterprise: 'Enterprise (20+)',
};

function prompt(rl, question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

function detectStacks(dir) {
  const ctx = new ProjectContext(dir);
  return ctx.detectStacks(STACKS);
}

function labelPlatforms(platforms) {
  return platforms.map((p) => PLATFORM_LABELS[p] || p).join(', ');
}

function parsePlatforms(input) {
  return input
    .split(/[,\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => ALL_PLATFORMS.includes(s));
}

async function runInit(dir, flags) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const dim = '\x1b[2m';
  const bold = '\x1b[1m';
  const cyan = '\x1b[36m';
  const green = '\x1b[32m';
  const reset = '\x1b[0m';

  console.log('');
  console.log(`${bold}  Welcome to Nerviq${reset} — let's set up your AI coding agent governance.`);
  console.log('');

  // --- Question 1: Platforms ---
  const detected = detectPlatforms(dir);
  const detectedLabel = detected.length > 0
    ? `${dim}[auto-detected: ${labelPlatforms(detected)}]${reset}`
    : `${dim}[no platforms detected]${reset}`;
  console.log(`  ${bold}1.${reset} Which platform(s) do you use?`);
  console.log(`     ${detectedLabel}`);
  const platformInput = await prompt(
    rl,
    `     ${dim}> Press Enter to confirm, or type: ${ALL_PLATFORMS.join(',')}${reset}\n     > `,
  );
  const platforms = platformInput === ''
    ? (detected.length > 0 ? detected : ['claude'])
    : parsePlatforms(platformInput);
  if (platforms.length === 0) platforms.push('claude');

  console.log('');

  // --- Question 2: Stack ---
  const stacks = detectStacks(dir);
  const stackLabels = stacks.map((s) => s.label);
  const stackDetectedLabel = stackLabels.length > 0
    ? `${dim}[auto-detected: ${stackLabels.join(', ')}]${reset}`
    : `${dim}[no stack detected]${reset}`;
  console.log(`  ${bold}2.${reset} What's your primary stack?`);
  console.log(`     ${stackDetectedLabel}`);
  const stackInput = await prompt(
    rl,
    `     ${dim}> Press Enter to confirm, or type your stack${reset}\n     > `,
  );
  const stackDisplay = stackInput === ''
    ? (stackLabels.length > 0 ? stackLabels.join(', ') : 'General')
    : stackInput;

  console.log('');

  // --- Question 3: Team size ---
  console.log(`  ${bold}3.${reset} What's your team size?`);
  const teamInput = await prompt(
    rl,
    `     ${dim}> solo / small (2-5) / team (6-20) / enterprise (20+)${reset}\n     > `,
  );
  const teamKey = TEAM_SIZES.find((t) => teamInput.toLowerCase().startsWith(t)) || 'solo';
  const teamLabel = TEAM_LABELS[teamKey];

  rl.close();

  console.log('');
  console.log(`  ${cyan}Setting up for: ${labelPlatforms(platforms)} | ${stackDisplay} | ${teamLabel}${reset}`);
  console.log('');

  // --- Run audit (before) ---
  const primaryPlatform = platforms[0];
  console.log(`  ${dim}Running audit...${reset}`);
  const preResult = await audit({ dir, silent: true, platform: primaryPlatform });
  const preScore = preResult.score;
  console.log(`  Score: ${bold}${preScore}/100${reset}`);
  console.log('');

  // --- Run setup ---
  console.log(`  ${dim}Running setup...${reset}`);
  const setupResult = await setup({
    dir,
    platform: primaryPlatform,
    silent: true,
    profile: 'safe-write',
    mcpPacks: [],
  });

  for (const f of setupResult.writtenFiles) {
    console.log(`  ${green}${icon('ok')}${reset} Created ${f}`);
  }
  for (const f of setupResult.preservedFiles) {
    console.log(`  ${dim}${icon('skip')} Kept ${f} (already exists)${reset}`);
  }

  // --- Run additional platform setups ---
  for (const plat of platforms.slice(1)) {
    try {
      const extraResult = await setup({
        dir,
        platform: plat,
        silent: true,
        profile: 'safe-write',
        mcpPacks: [],
      });
      for (const f of extraResult.writtenFiles) {
        console.log(`  ${green}${icon('ok')}${reset} Created ${f}`);
      }
    } catch {
      // Platform setup not available, skip
    }
  }

  // --- Run audit (after) ---
  const postResult = await audit({ dir, silent: true, platform: primaryPlatform });
  const postScore = postResult.score;
  const delta = postScore - preScore;

  if (delta > 0) {
    console.log(`  Score: ${bold}${postScore}/100${reset} (${green}+${delta}${reset})`);
  } else {
    console.log(`  Score: ${bold}${postScore}/100${reset}`);
  }

  console.log('');
  console.log(`  ${bold}Next steps:${reset}`);
  console.log(`  - Review:        ${cyan}nerviq audit --full${reset}`);
  if (platforms.length > 1) {
    console.log(`  - Cross-platform: ${cyan}nerviq harmony-audit${reset}`);
  }
  console.log(`  - Customize:     ${cyan}nerviq augment${reset}`);
  console.log('');
}

module.exports = { runInit };
