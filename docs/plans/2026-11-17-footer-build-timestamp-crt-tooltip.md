---
title: Footer Build Timestamp & CRT Popover Tooltip
status: implemented
created_at: 2026-11-17T19:26:38Z
implemented_at: 2026-11-17T19:28:35Z
---

# Footer Build Timestamp & CRT Popover Tooltip

Emit the release or build timestamp from CI, container metadata, and local git history into the service status snapshot, and upgrade the footer version and commit indicators with a styled CRT popover tooltip displaying the local date, time, and relative age.

## User Review & Critical Decisions

- **Confirmed Decision 1 (Timestamp Source & Wiring)**: Emit the build/release timestamp end-to-end across the release workflow, container build arguments and OCI labels, local git fallback metadata, and the service status API payload (`build.builtAt`).
- **Confirmed Decision 2 (Tooltip Presentation)**: Replace the plain browser title hints on the footer version and commit elements with a styled CRT popover (`role="tooltip"`) matching the existing sidebar telemetry popovers, active on both hover and keyboard focus for links and local fallback spans.
- **Confirmed Decision 3 (Timestamp Formatting)**: Display the timestamp in the user's local date and time paired with a human-readable relative age indicator (for example, `Nov 17, 2026, 11:25 AM · 4m ago`) when present in the service status.

---

## 1. Overview & Core Concept

- **What It Does**: Surfaces an exact, human-readable build or release timestamp whenever hovering or focusing either the semantic version or commit SHA in the sidebar/mobile footer, backed by real build provenance injected during CI release/container builds or local git execution.
- **Target Audience / Persona**: Self-hosters and operators running RetroGameTalk Sync in Kubernetes, Docker, or local development who want quick confirmation of how recent a deployed build or release is without inspecting container labels or GitHub Releases manually.
- **Key Value**: Eliminates guesswork about deployed build freshness in a single zero-clutter glance while keeping the inconspicuous footer footprint compact and faithful to the CRT diagnostic aesthetic.

---

## 2. User Experience & Visual Design

- **Key User Flows**:
  1. **Hover / Keyboard Focus on Version or SHA**: Moving the pointer over or tabbing onto either the footer version or short SHA immediately opens a crisp CRT diagnostic popover highlighting the active field (`Version / Release Tag` or `Commit / Revision Hash`).
  2. **Timestamp Present (CI / Container / Git Build)**: Displays the build/release timestamp formatted in the browser's local date and time alongside a live relative age string (`just now`, `12m ago`, `3d ago`), plus the revision hash and repository link hint when linked.
  3. **Timestamp Absent (Sandboxed or Unset Dev Runtime)**: Keeps the build footer compact and displays `Not reported in status` in the timestamp slot so hover/focus feedback remains consistent without inventing fake times.
  4. **Dismissal**: Moving the pointer away, blurring focus, or pressing `Escape` closes the popover cleanly.
- **Visual Identity & Theme**:
  - Retro-futuristic CRT diagnostic instrument matching existing sidebar telemetry and mirrored-systems popovers using `--crt-surface`, `--crt-border-strong`, `--crt-text`, `--crt-muted`, and `--crt-phosphor`, `font-mono tabular-nums`, and counter-sweeping `crt-edge-beam` borders (`prefers-reduced-motion` compliant).
  - Positioned to the right of the desktop sidebar rail (`lg:left-full`) and upward within viewport bounds on mobile screens.

---

## 3. Technical Summary

- **CI & Container Build**: `.github/workflows/docker-publish.yml` emits `release_date` / `built_at` and passes `BUILT_AT` into `Dockerfile`, which populates OCI label `org.opencontainers.image.created` and runtime `ENV BUILT_AT`.
- **Server Runtime**: `resolveRuntimeBuildInfo()` reads `BUILT_AT` / `RELEASE_DATE` / `BUILD_TIMESTAMP` / `BUILD_DATE` or falls back to `git show -s --format=%cI HEAD`, exposing `build.builtAt: string | null` in `/api/status`.
- **Frontend**: `formatRelativeAge` and `formatLocalDateTimeWithAge` format the localized date/time + relative age; `BuildFooterMeta` renders hover/focus-accessible triggers and the floating CRT `[role="tooltip"]` popover.
- **Version Sync**: Bumped `package.json` `"version"` and `k8s/charts/retrogametalk-sync/Chart.yaml` `appVersion` to `1.0.1`.
