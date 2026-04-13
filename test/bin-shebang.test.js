const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

describe('bin entries have a node shebang', () => {
  // Regression test for commit 40c27b8 (2026-04-12), which accidentally
  // dropped the #!/usr/bin/env node line from bin/cli.js while fixing the
  // macOS pipe-flush issue. Without a shebang, `npx @nerviq/cli` fails on
  // Linux/Mac because the OS falls back to /bin/sh and tries to execute
  // JavaScript as shell.

  for (const [binName, relPath] of Object.entries(pkg.bin || {})) {
    test(`${binName} -> ${relPath} starts with #!/usr/bin/env node`, () => {
      const full = path.join(ROOT, relPath);
      const buf = Buffer.alloc(64);
      const fd = fs.openSync(full, 'r');
      try { fs.readSync(fd, buf, 0, 64, 0); } finally { fs.closeSync(fd); }
      const head = buf.toString('utf8').replace(/\r/g, '');
      expect(head.startsWith('#!/usr/bin/env node\n')).toBe(true);
    });
  }
});
