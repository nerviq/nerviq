# Publishing to Open VSX Registry

## What is Open VSX?

Open VSX is an open, vendor-neutral registry for VS Code extensions, hosted by the Eclipse Foundation.

## Why Publish to Open VSX?

Cursor IDE uses Open VSX (not Microsoft's VS Code Marketplace) as its extension backend. Microsoft's licensing blocks non-VS-Code forks from accessing their marketplace, so Cursor, VSCodium, and Gitpod all rely on Open VSX instead.

**Publishing to Open VSX gives us compatibility with all three platforms for free.**

See: [Cursor Marketplace Research (2026-04-06)](../../research/cursor-marketplace-research-2026-04-06.md)

## VS Code Extension Source

The Nerviq VS Code extension lives in this repo at [`vscode-extension/`](../vscode-extension/).

## How to Get a Token

1. Create an account at [accounts.eclipse.org](https://accounts.eclipse.org/)
2. Go to [open-vsx.org](https://open-vsx.org/) and sign in with your Eclipse account
3. Navigate to your user settings and generate an access token
4. Store the token as `OVSX_TOKEN` in your GitHub repository secrets

## How to Publish Manually

```bash
# Package the extension
cd vscode-extension
npm install
npx @vscode/vsce package

# Publish to Open VSX
npx ovsx publish *.vsix -p <your-token>
```

## Automated Publishing

A GitHub Actions workflow is available at [`.github/workflows/publish-ovsx.yml`](../.github/workflows/publish-ovsx.yml). It runs on manual dispatch (`workflow_dispatch`) and requires the `OVSX_TOKEN` secret to be configured.

## References

- [Open VSX Registry](https://open-vsx.org/)
- [Open VSX Publishing Guide](https://github.com/eclipse/openvsx/wiki/Publishing-Extensions)
- [Eclipse Foundation Account](https://accounts.eclipse.org/)
