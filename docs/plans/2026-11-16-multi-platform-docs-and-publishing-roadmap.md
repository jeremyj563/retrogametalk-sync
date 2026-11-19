---
title: Multi-Platform Installation Docs & Publishing Roadmap
status: implemented
created_at: 2026-11-16T15:00:36Z
implemented_at: 2026-11-19T03:50:00Z
---

# Multi-Platform Installation Docs & Publishing Roadmap

Transforms RetroGameTalk Sync from a Helm-only setup into an approachable, homelab-ready application with clear installation guides for **Docker**, **Docker Compose**, **Portainer / Dockge**, **Proxmox VE (LXC)**, **TrueNAS SCALE (Community Edition)**, **Unraid**, and **Kubernetes / Helm**—paired with a staged, safety-gated publishing pipeline for **GHCR** and **Docker Hub** (`linux/amd64` + `linux/arm64`).

## User Review & Critical Decisions

> [!IMPORTANT]
> **Zero Accidental Public Releases**: Nothing in this roadmap publishes to public catalogs automatically. Public Docker Hub pushes stay disabled until you configure registry secrets and push an explicit release tag, and Unraid / TrueNAS app store listings require deliberate manual portal submission or PRs by you when `rgt-sync` is ready.

- **Confirmed — Dual-Registry Multi-Arch Target**: Build pipelines will target both **GitHub Container Registry (GHCR)** and **Docker Hub** for `linux/amd64` and `linux/arm64` (supporting x86 homelab servers, NAS appliances, Raspberry Pi/ARM nodes, and Apple Silicon desktops).
- **Confirmed — Strict 6-Platform + Helm Focus**: Documentation covers strictly the six requested platforms (**Docker**, **Docker Compose**, **Portainer / Dockge**, **Proxmox VE LXC**, **TrueNAS SCALE Community Edition**, **Unraid**) alongside existing **Kubernetes / Helm** deployment.
- **Confirmed — Staged Execution**: Archived as a `planned` roadmap first so each implementation phase (docs, templates, gated multi-arch CI, and marketplace submissions) can be reviewed and guided step-by-step.

---

## 1. Overview & Core Concept

- **What It Delivers**: A tiered, copy-paste-friendly deployment hub in the repository paired with a disciplined release pipeline and prioritized marketplace submission plan.
- **Why Tiered Prioritization Matters**: Homelab ecosystems fall into two distinct groups—**Compose/Container UIs** (where prebuilt multi-arch images + clean Compose/run snippets give an immediate 2-minute install) and **Curated App Marketplaces** (Unraid Community Applications, TrueNAS `truenas/apps`), which enforce strict template schemas, support threads, and frozen volume/env contracts.
- **Key Value**: Users can install `rgt-sync` immediately on any of the six platforms without waiting for third-party catalog approvals, while every template and CI workflow builds cleanly toward 1-click marketplace readiness.

---

## 2. Documentation & User Experience Design

### Root Quickstart Hub + Platform-Specific Guides

Instead of burying users in a wall of YAML on the landing page, the repository documentation uses a **"Pick Your Platform" quick-index** that routes users straight to concise, 3-step install recipes:

1. **Concise Root Landing Overview**:
   - One-sentence summary, minimal prerequisites (a RetroGameTalk account + host storage path for mirrored ROMs and `.rgt-data` state), and a clean compatibility matrix linking each platform to its exact install method and estimated setup time.
   - Standardizes all environment variables (`PORT`, `DATA_DIR`, `DOWNLOAD_DIR`, `RGT_USERNAME`, `RGT_PASSWORD`, `CRON_SCHEDULE`, `SCRAPER_SYSTEM_FILTER`, `SCRAPER_RELEASE_TYPE_FILTER`) and port (`3000`) consistently across every guide (and fixes the stale Helm chart path in the current landing doc).
2. **Self-Contained Platform Guides**:
   - **Docker Desktop / Rancher Desktop / Podman Desktop**: Single `docker run` / `podman run` command with prebuilt GHCR/Docker Hub image, volume mount, port `3000`, and GUI container setup notes (including Podman's `:Z` SELinux volume label tip where applicable).
   - **Docker Compose / Podman Compose**: Production-ready Compose snippet defaulting to the published multi-arch image (with an optional commented `build: .` override for local builders), `.env` walkthrough, and clean upgrade command (`pull && up -d`).
   - **Portainer & Dockge**: Copy-paste Web UI Stack YAML plus Git-repository stack instructions (pointing Portainer/Dockge straight to the repo Compose definition for 1-click pulls and redeployments).
   - **Unraid**: Clear setup covering host shares (`/mnt/user/appdata/rgt-sync` vs ROMs share), WebUI URL (`http://[IP]:[PORT:3000]`), plus future 1-click install via Unraid **Apps** (Community Applications) once published.
   - **TrueNAS SCALE (Community Edition)**: Two paths—immediate **Custom App (`Install via YAML`)** instructions compatible with TrueNAS Electric Eel+ native Docker Compose datasets, followed later by official **Discover Apps** search once accepted into the Community train.
   - **Proxmox VE (LXC)**: Covers both **Proxmox VE 9.1+ Native OCI LXC** deployment (pulling the container image directly into an LXC) and the widely used **Unprivileged Debian/Alpine Docker-in-LXC** pattern (enabling `nesting=1,keyctl=1` + separating persistent ROM storage onto a dedicated Proxmox mount point).

---

## 3. Prioritized Publishing Roadmap & Best Practices

### Priority 1 — Multi-Arch Container Foundation & Instant Compose/UI Platforms *(Do First)*

Every downstream platform (Portainer, Dockge, Unraid, TrueNAS, Proxmox OCI) depends on a trustworthy, fast, multi-architecture container image.

- **Platforms Unlocked Immediately**: **Docker Desktop / Rancher / Podman**, **Docker / Podman Compose**, **Portainer**, **Dockge**, and **Kubernetes / Helm**.
- **CI/CD Best Practices**:
  - Upgrade the existing GitHub Actions workflow to build `linux/amd64,linux/arm64` via Docker Buildx + QEMU with GitHub Actions layer caching (`type=gha`).
  - Attach standard OCI labels (`source`, `description`, `licenses`, `version`, `revision`) plus Buildx provenance/SBOM attestations (`provenance: mode=max`, `sbom: true`)—trusted registries and homelab scanners increasingly verify these.
  - **Strict Release Gating**:
    - `main` branch builds push only a rolling edge/main tag to **GHCR** (or dry-run on PRs).
    - **Docker Hub** publishing executes **only** when a semantic release tag (`v*.*.*`) is pushed *and* repository secrets (`DOCKERHUB_USERNAME`, `DOCKERHUB_TOKEN`) exist—preventing accidental public Docker Hub pushes while iterating.
  - Ensure `7zip-bin` / `7zip` and `better-sqlite3` native compilation work cleanly on both `amd64` and `arm64` Alpine inside multi-arch Buildx runs before tagging `v1.0.0`.

### Priority 2 — Unraid Community Applications *(First Official 1-Click Marketplace)*

**Why Unraid First?** Unraid CA has the lowest maintenance overhead and fastest turnaround among homelab marketplaces: once your GitHub template repository passes initial portal validation, updates to your XML template sync automatically from your `main` branch without needing upstream PR reviews for every tweak.

- **Pre-Launch Checklist (When Ready to Go Public)**:
  1. Ensure the repo is **public**, has an OSI-approved `LICENSE` file, and has a stable `v1.0.0` multi-arch image live on Docker Hub / GHCR.
  2. Create a clean square app icon (hosted via raw GitHub URL), root `ca_profile.xml`, and a `Container version="2"` XML template mapping port `3000`, persistent storage paths, and optional env vars.
  3. Validate XML syntax cleanly in CI (`xmllint --noout`), and test locally inside Unraid first via `Docker -> Add Container -> Template Repositories` before making it public.
  4. Open a dedicated `[Support]` thread on the Unraid Forums, then submit the repo via **`ca.unraid.net`** using its built-in Validate & Scan tool.

### Priority 3 — TrueNAS SCALE Community Edition (`truenas/apps`) *(Second Official Marketplace)*

**Why TrueNAS Second?** Starting with TrueNAS SCALE *Electric Eel* (24.10+), TrueNAS replaced legacy k3s/Helm apps with native **Docker Engine + Docker Compose**—making `rgt-sync` naturally compatible without Helm chart rewrites. However, submitting to the official `truenas/apps` **`community` train** requires a formal upstream PR and strict schema adherence, so it is best done *after* volume paths and environment variables are stable.

- **Stage 3A (Immediate — Zero Gatekeepers)**: Document TrueNAS **Apps → Discover Apps → Custom App → Install via YAML** using a TrueNAS-tailored Compose YAML and host dataset mapping.
- **Stage 3B (When Ready — Official Catalog PR)**:
  1. Target `ix-dev/community/retrogametalk-sync/` in a fork of `github.com/truenas/apps`.
  2. Provide required manifests: `app.yaml`, `ix_values.yaml`, Web UI form schema (`questions.yaml`), Jinja2 Compose renderer (`templates/docker-compose.yaml`), `README.md`, and `templates/test_values/basic-values.yaml` (leaving `item.yaml` auto-generated by TrueNAS CI).
  3. Validate locally against TrueNAS's `ci.py` test runner before opening the upstream PR.

### Priority 4 — Proxmox VE (LXC) & Optional OCI Helm Polish

- **Proxmox VE Best-Practice Strategy**:
  - Proxmox does not have a single built-in "app store" like Unraid or TrueNAS; homelabbers install apps via **Native OCI LXC** (Proxmox VE 9.1+), **Docker inside an Unprivileged Debian/Alpine LXC**, or **Community Helper Scripts**.
  - Prioritize clear copy-paste guides for both **Native OCI LXC** and **Docker-in-LXC** (emphasizing persistent Proxmox mount points so container OS rebuilds never touch mirrored ROMs). Community helper-script PRs (`community-scripts/ProxmoxVE`) can be evaluated later once `rgt-sync` has an established user base and stable release cadence.
- **Helm Chart OCI Publishing**: Extend CI on release tags to package and push the existing chart to `ghcr.io/<owner>/charts/retrogametalk-sync`, allowing `helm install oci://...` without cloning the repo.

---

## 4. Technical Architecture & Safety-Gated Release Flow

```
┌───────────────────────────────────────────────────────────────────────────┐
│ Source & Documentation Readiness (Safe In-Repo Staging)                   │
│ · Root Quickstart Hub + 7 Platform Guides (Docker, Compose, Portainer/    │
│   Dockge, Proxmox LXC, TrueNAS Custom YAML, Unraid Local XML, K8s/Helm)   │
│ · Local template validation (compose config, helm lint, xmllint)          │
└───────────────────────────────┬───────────────────────────────────────────┘
                                │
                                ▼ (Explicit Git Tag vX.Y.Z + Opt-In Secrets)
┌───────────────────────────────────────────────────────────────────────────┐
│ Automated Multi-Arch CI Pipeline (linux/amd64 + linux/arm64)              │
│ · GHCR Image + OCI Helm Chart (always gated to main / release tags)       │
│ · Docker Hub Mirror (pushes ONLY when DOCKERHUB_* secrets are configured) │
│ · Attestations: OCI labels + SBOM + build provenance                      │
└───────────────────────────────┬───────────────────────────────────────────┘
                                │
                                ▼ (Manual Maintainer Action — Never Auto-Run)
┌───────────────────────────────────────────────────────────────────────────┐
│ Public Marketplace Distribution (Staged Rollout)                          │
│ 1. Unraid CA Portal (ca.unraid.net)  <-- Lowest friction, auto-syncs main │
│ 2. TrueNAS Apps PR (truenas/apps)    <-- Community train Jinja2/YAML PR   │
│ 3. Optional: Artifact Hub (Helm OCI) & Proxmox Community Scripts          │
└───────────────────────────────────────────────────────────────────────────┘
```

### Pre-Publish Readiness Checklist (Before Opening to the Public)

- Verify clean multi-arch `linux/amd64` + `linux/arm64` container builds (specifically native `better-sqlite3` and `7zip` runtime extraction on ARM64).
- Confirm open-source `LICENSE` file exists at repository root (required by Unraid CA, TrueNAS `apps`, and Docker Hub badge trust).
- Freeze canonical container paths (`/run/repo` + `/run/repo/.rgt-data`) and environment variable names so early adopters and marketplace templates never suffer breaking volume migrations.
- Add `.env` / Compose / template validation checks on pull requests so documentation snippets never drift from actual server behavior.
