# NPM Release Process

## Automated Release (GitHub Actions)

The repository now has automated npm publishing via GitHub Actions.

### Setup (One-time)

1. **Create NPM Access Token:**
   - Go to https://www.npmjs.com/settings/YOUR_USERNAME/tokens
   - Click "Generate New Token" → "Classic Token"
   - Select "Automation" type
   - Copy the token

2. **Add Token to GitHub Secrets:**
   - Go to https://github.com/USERNAME/discord-irc/settings/secrets/actions
   - Click "New repository secret"
   - Name: `NPM_TOKEN`
   - Value: Paste your npm token
   - Click "Add secret"

### Publishing a New Version

The workflow automatically publishes when you push a version tag:

```bash
# 1. Update version in package.json
npm version patch  # or minor, or major
# This creates: 1.2.4 → 1.2.5

# 2. Update CHANGELOG.md
# Change [Unreleased] to [1.2.5] - 2025-11-25

# 3. Commit changes
git add -A
git commit -m "chore: release v1.2.5"

# 4. Create and push tag
git tag -a v1.2.5 -m "Release v1.2.5"
git push origin main
git push origin v1.2.5
```

**The GitHub Action will automatically:**
- ✅ Checkout code
- ✅ Install dependencies
- ✅ Build TypeScript
- ✅ Run tests
- ✅ Publish to npm (if all tests pass)

### Current Release (v1.2.4)

**Status:** Ready to push
**Tag:** v1.2.4 created locally
**Commits:** 10 commits ahead of origin/main

**To trigger the automated publish:**

```bash
# Push commits and tag to GitHub
git push origin main
git push origin v1.2.4
```

This will trigger the GitHub Action and automatically publish to npm!

### Manual Publishing (Fallback)

If you need to publish manually:

```bash
# 1. Build
npm run build

# 2. Test
npm test

# 3. Login to npm (if not already)
npm login

# 4. Publish
npm publish
```

## Version History

- **v1.2.4** (2025-11-25) - IRC disconnection alerts, interaction crash fix, Bun S3 support
- **v1.2.3** (2025-11-20) - 100% TypeScript type safety, code quality improvements
- **v1.2.2** (2025-11-XX) - S3 file management system
- **v1.2.1** (2025-11-09) - Config schema fixes
- **v1.2.0** (2025-01-XX) - Bun runtime support

## Workflow File

Located at: `.github/workflows/npm-publish.yml`

Triggers on: Push of tags matching `v*` pattern
