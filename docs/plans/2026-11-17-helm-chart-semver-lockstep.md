---
title: Lockstep Helm Chart & Application SemVer Synchronization
status: implemented
created_at: 2026-11-17T20:11:14Z
implemented_at: 2026-11-17T20:12:00Z
---

# Lockstep Helm Chart & Application SemVer Synchronization

Synchronize the Helm chart's packaging `version` alongside `appVersion` and the Node package manifest on every release increment, enforce three-way version parity in the CI release gate, and bump all version declarations to `1.0.3`.

## User Review & Critical Decisions

- **Confirmed Decision 1 (CI Enforcement)**: Extend the GitHub Actions release validation job to verify strict parity across `package.json` `"version"`, `Chart.yaml` `version`, and `Chart.yaml` `appVersion`.
- **Confirmed Decision 2 (Initial Synchronized Release)**: Increment `package.json` `"version"`, `Chart.yaml` `version`, and `Chart.yaml` `appVersion` together to `1.0.3`.
- **Confirmed Decision 3 (Distribution Scope)**: Keep `Chart.yaml` synchronized in Git for Git-tag installs without adding `.tgz` release attachments or Helm OCI pushes.

---

## 1. Technical Summary

- **CI Enforcement**: `.github/workflows/docker-publish.yml` validates both `Chart.yaml` `version` and `appVersion` against `package.json` `"version"` before minting bare SemVer tags and GitHub Releases.
- **Manifest Synchronization**: Bumped `package.json` `"version"`, `k8s/charts/retrogametalk-sync/Chart.yaml` `version`, and `Chart.yaml` `appVersion` to `1.0.3`.
- **Policy & Documentation**: Updated `AGENTS.md` and `/docs/release/README.md` to mandate three-way SemVer lockstep across all releases within the `1.x.y` policy.
