#!/usr/bin/env node
/**
 * NERVIQ Auto-Publisher
 * Publishes content to all platforms automatically where possible,
 * opens pre-filled browser for platforms that need manual submit.
 *
 * Usage: node tools/publish.js [platform]
 * Platforms: devto, hn, reddit, all
 */

const https = require('https');
const http = require('http');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Load env
const envPath = path.join(__dirname, '..', '.env');
const env = {};
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const match = line.match(/^([A-Z_]+)=(.+)$/);
    if (match) env[match[1]] = match[2];
  });
}

const platform = process.argv[2] || 'all';

// === Dev.to: Full API automation ===
async function publishDevTo(article) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ article });
    const req = https.request({
      hostname: 'dev.to',
      path: '/api/articles',
      method: 'POST',
      headers: {
        'api-key': env.DEVTO_API_KEY,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        const result = JSON.parse(body);
        if (result.url) {
          console.log(`  ✅ Dev.to: ${result.url}`);
          resolve(result);
        } else {
          console.log(`  ❌ Dev.to: ${result.error || JSON.stringify(result)}`);
          reject(result);
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// === Hacker News: Open pre-filled browser ===
function publishHN(title, url) {
  const hnUrl = `https://news.ycombinator.com/submitlink?u=${encodeURIComponent(url)}&t=${encodeURIComponent(title)}`;
  console.log(`  🌐 Opening Hacker News submit page...`);
  openBrowser(hnUrl);
  console.log(`  ⚠️  HN requires manual submit (click button in browser)`);
}

// === Reddit: Open pre-filled browser (until API approved) ===
function publishReddit(subreddit, title, text) {
  const redditUrl = `https://www.reddit.com/r/${subreddit}/submit?type=TEXT&title=${encodeURIComponent(title)}&text=${encodeURIComponent(text)}`;
  console.log(`  🌐 Opening Reddit r/${subreddit} submit...`);
  openBrowser(redditUrl);
  console.log(`  ⚠️  Reddit requires manual submit (select flair + click Post)`);
}

// === Open browser cross-platform ===
function openBrowser(url) {
  try {
    if (process.platform === 'win32') {
      execSync(`start "" "${url}"`);
    } else if (process.platform === 'darwin') {
      execSync(`open "${url}"`);
    } else {
      execSync(`xdg-open "${url}"`);
    }
  } catch {
    console.log(`  📋 Open manually: ${url}`);
  }
}

// === Content library ===
const CONTENT = {
  hn: {
    title: 'Show HN: nerviq – Audit any project for Claude Code optimization (1,107 entries)',
    url: 'https://github.com/nerviq/nerviq',
  },
  reddit: {
    title: 'I built a CLI that audits your project for Claude Code optimization — scores 0-100 (1,107 catalog entries)',
    text: `After cataloging 1,107 Claude Code entries and verifying 948 of them with real evidence, I built a free CLI that checks if your project is actually set up to get the most out of Claude Code.

Most projects score 10-20 out of 100. After running setup, they jump to 70+.

    npx @nerviq/cli

It checks 85 Claude Code setup signals: CLAUDE.md, hooks, commands, skills, agents, Mermaid diagrams, XML tags, path rules, MCP config, permissions, and more.

Then npx @nerviq/cli setup creates everything that's missing, tailored to your stack (React, Python, TypeScript, Rust, Go, etc).

- Zero dependencies
- No API keys needed
- Runs entirely on your machine
- Free and open source

GitHub: https://github.com/nerviq/nerviq`,
    subreddits: ['ClaudeAI', 'ChatGPTCoding'],
  },
};

// === Main ===
async function main() {
  console.log('\n  📡 NERVIQ Publisher\n');

  let configErrors = 0;

  if (platform === 'devto' || platform === 'all') {
    console.log('  --- Dev.to ---');
    if (!env.DEVTO_API_KEY) {
      console.log('  ❌ Missing DEVTO_API_KEY in .env');
      configErrors += 1;
    } else {
      console.log('  ℹ️  Dev.to article already published. Use for new articles.');
    }
  }

  if (platform === 'hn' || platform === 'all') {
    console.log('  --- Hacker News ---');
    publishHN(CONTENT.hn.title, CONTENT.hn.url);
  }

  if (platform === 'reddit' || platform === 'all') {
    console.log('  --- Reddit ---');
    for (const sub of CONTENT.reddit.subreddits) {
      publishReddit(sub, CONTENT.reddit.title, CONTENT.reddit.text);
    }
  }

  console.log('\n  Done.\n');

  if (configErrors > 0) {
    process.exitCode = 2;
  }
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
