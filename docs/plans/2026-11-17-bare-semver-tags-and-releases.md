---
title: Bare SemVer Tagging (1.0.0 Without 'v' Prefix)
status: implemented
created_at: 2026-11-17T18:56:16Z
implemented_at: 2026-11-17T18:58:00Z
---

# Bare SemVer Tagging (`1.0.0` Without `v` Prefix)

Updates the automated release pipeline, runtime version reporting, repository conventions, and release documentation to use pure `X.Y.Z` SemVer identifiers (`1.0.0` instead of `v1.0.0`) across git tags, GitHub Releases, and GHCR container image tags.

---

### Confirmed Decisions

- **Hold Baseline at `1.0.0`**: Keep `package.json` `"version"` and Helm `Chart.yaml` `appVersion` at `1.0.0` for this commit so pushing to `main` mints the fresh `1.0.0` tag and GitHub Release.
- **Legacy `v1.0.0` Cleanup Complete**: Maintainer deleted the earlier `v1.0.0` git tag and GitHub Release directly in the GitHub UI.
- **Drop `v` Everywhere**: Remove `v` from git tags (`1.0.0`), GitHub Release titles (`1.0.0`), GHCR container tags (`1.0.0`, `1.0`), and runtime fallback version strings (`1.0.0`).
