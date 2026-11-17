---
title: Automated SemVer Versioning, GitHub Releases & Release Policy (v1.x.y)
status: implemented
created_at: 2026-11-17T18:38:55Z
implemented_at: 2026-11-17T18:41:00Z
---

# Automated SemVer Versioning, GitHub Releases & Release Policy (`v1.x.y`)

Establishes a reproducible Semantic Versioning (`v1.x.y`) release pipeline where every committed change increments either `MINOR` or `PATCH` within the `v1` constraint, synchronizes runtime and Helm deployment metadata, and automatically mints annotated git tags, GitHub Releases with generated notes, and tagged GHCR container images on push to `main`.

---

### Confirmed Decisions

- **Automated Tag & GitHub Release Execution**: `.github/workflows/docker-publish.yml` automatically creates annotated `v1.x.y` git tags and GitHub Releases (`--generate-notes`) on pushes to `main`.
- **Synchronized Version Targets**: Starting from `1.0.0`, `package.json` `"version"` and `k8s/charts/retrogametalk-sync/Chart.yaml` `appVersion` bump in lockstep (with `Chart.yaml` `version` independent for Helm packaging changes).
- **Release Notes & Container Publishing**: Newly minted `v1.x.y` releases chain directly into the GHCR build job to publish `vX.Y.Z`, `X.Y.Z`, `X.Y`, `latest`, `main`, and `sha-*` tags.

---

### Release Pipeline Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Development & Pre-Commit Phase (AGENTS.md Rules)                        │
│  • Patch vs Minor rules & v1.x.y lock in AGENTS.md                       │
│  • Sync package.json version + Chart.yaml appVersion (baseline: 1.0.0)   │
│  • Runtime build-info reader falls back to package.json when non-git     │
└───────────────────────────────┬──────────────────────────────────────────┘
                                │ (Commit / Push to main)
                                ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  Job 1: Release & Tag Validation (contents: write)                       │
│  1. Parse strict X.Y.Z SemVer, verify MAJOR=1 (unless opted) & Chart sync│
│  2. Check if git tag vX.Y.Z already exists on origin                     │
│  3. If new: create annotated tag vX.Y.Z + publish GitHub Release w/notes │
│  4. Emit outputs: release_tag, semver_full, semver_minor                 │
└───────────────────────────────┬──────────────────────────────────────────┘
                                │ (needs: release)
                                ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  Job 2: Container Build & GHCR Publish (packages: write)                 │
│  • Resolves tag from Job 1 output (on main push) or tag ref (manual tag) │
│  • Injects APP_VERSION=vX.Y.Z + GIT_SHA + GIT_URL build args             │
│  • Pushes tags: latest, main, vX.Y.Z, X.Y.Z, X.Y, sha-<short>            │
└──────────────────────────────────────────────────────────────────────────┘
```
