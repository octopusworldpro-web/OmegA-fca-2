# OmegA-FCA npm release publishing

This repository publishes stable releases to npm's `latest` dist-tag and prereleases to `next`.

## Current stable release candidate

- Package: `@nirzon-islam/omega-fca`
- Target version: `0.1.6`
- Git tag / GitHub Release: `v0.1.6`
- Registry: `https://registry.npmjs.org/`
- Dist-tag: `latest`

## Required repository secret

Configure the repository Actions secret:

- Name: `NPM_TOKEN`
- Value: an npm access token with publish permission for `@nirzon-islam/omega-fca`

Never commit or paste the token into source code, chat, or logs. The workflow uses GitHub Actions OIDC provenance and the token for npm registry authentication.

## Prepare and publish stable 0.1.6

1. Confirm `package.json` and `package-lock.json` both declare `0.1.6`.
2. Run the full test suite, TypeScript tests, syntax checks, and inspect `npm pack --dry-run`.
3. Create and push the Git tag `v0.1.6` on the approved `main` commit.
4. Create and publish the GitHub Release for `v0.1.6` (not marked as a prerelease).
5. The `Publish npm release` workflow runs automatically. Alternatively, run it manually from Actions, select `main`, and enter `v0.1.6`.
6. Wait for the publish and post-publish tarball verification steps to succeed.

The workflow checks out the exact tag, runs `npm ci`, tests, type checks, syntax checks, validates the package version against the tag, inspects the packed contents, publishes with provenance to `latest`, then downloads the registry tarball and confirms that `index.js` and `index.d.ts` are present.

## Verify the published artifact

After the workflow succeeds:

```sh
npm view @nirzon-islam/omega-fca@latest version
npm view @nirzon-islam/omega-fca dist-tags
npm pack @nirzon-islam/omega-fca@latest
```

Confirm that `latest` resolves to `0.1.6` and inspect the packed tarball. Only after that should GoatBot's dependency and lockfile be updated to the exact published version and tested with `npm ci`.

## Release boundary

A successful package build and CI run do not prove Facebook login, MQTT event delivery, message sending, attachments, or private web actions work against Meta's live service. Those still require an authorized owner-controlled AppState acceptance run. Do not claim live-service compatibility without that acceptance evidence.
