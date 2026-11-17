---
title: GIT_REF Provenance & GitHub Release URL Resolution
status: implemented
created_at: 2026-11-17T19:42:50Z
implemented_at: 2026-11-17T19:44:10Z
---

# GIT_REF Provenance & GitHub Release URL Resolution

Introduce a dedicated `GIT_REF` build argument and runtime metadata field alongside `APP_VERSION`, and resolve release tags, branches, and pull-request refs into exact host-specific URLs (such as GitHub Releases) from `GIT_URL` and `GIT_REF`.

## User Review & Critical Decisions

- **Confirmed Decision 1 (Tag vs. Branch Detection)**: Classify any explicit `refs/tags/...` prefix as a release tag, and fall back to strict SemVer pattern matching when a bare ref is provided; classify `refs/heads/...` and non-SemVer refs as branches.
- **Confirmed Decision 2 (Fallback & Footer Display)**: Keep the compact footer trigger displaying `build.version`, while resolving `gitRef` from `GIT_REF`, local git metadata (`refs/tags/...` or `refs/heads/...`), or `APP_VERSION` when `GIT_REF` is unset.
- **Confirmed Decision 3 (Multi-Host & PR Ref Support)**: Support GitHub Releases, branches, and pull-request refs (`refs/pull/...`), alongside GitLab releases/merge requests/branches and Gitea/Codeberg releases/branches.

---

## 1. Technical Summary

- **CI & Container Build**: `.github/workflows/docker-publish.yml` emits `git_ref` (`refs/tags/<X.Y.Z>`, `refs/heads/<branch>`, or `refs/pull/<n>/merge`) and passes `GIT_REF` alongside `APP_VERSION`, `GIT_SHA`, `GIT_URL`, and `BUILT_AT` into `Dockerfile` (`ARG GIT_REF`, `ENV GIT_REF`).
- **Server Runtime**: `resolveRuntimeBuildInfo()` reads `GIT_REF` (falling back to local `git` tag/symbolic ref or resolved `APP_VERSION` when non-placeholder) and exposes `build.gitRef: string | null` in `/api/status`.
- **URL Resolution & Tooltip**: `resolveGitRefDestination()` maps `GIT_REF` + `GIT_URL` across GitHub (`/releases/tag/<tag>`, `/tree/<branch>`, `/pull/<n>`), GitLab (`/-/tags/<tag>`, `/-/tree/<branch>`, `/-/merge_requests/<n>`), Gitea/Codeberg, and Bitbucket, updating the footer version link and CRT `[role="tooltip"]` provenance display.
- **Version Sync**: Bumped `package.json` `"version"` and `k8s/charts/retrogametalk-sync/Chart.yaml` `appVersion` to `1.0.2`.
