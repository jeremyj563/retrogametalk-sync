# Containerization, CI/CD, Kubernetes Helm Chart & Observability

This document covers how `rgt-sync` is packaged, built, deployed, scaled, and monitored in production environments (`Dockerfile`, `docker-compose.yml`, `.github/workflows/docker-publish.yml`, `.github/workflows/update-screenshots.yml`, and `/k8s/charts/retrogametalk-sync`).

---

## 1. Multi-Stage Alpine Container (`Dockerfile`)

`rgt-sync` uses a multi-stage `node:22-alpine` build that compiles native N-API addons cleanly, bundles native multi-arch RAR4/RAR5/7z/ZIP archive extractors, and runs non-root:

### Stage 0 & 1: `unrar` + `builder` (`node:22-alpine`)
- Pulls the multi-arch Alpine `unrar` binary from `ghcr.io/linuxserver/unrar:latest` (needed because Alpine's `7zip` package strips proprietary RAR codecs).
- Installs build-time toolchain packages (`python3`, `make`, `g++`) to compile/verify native `better-sqlite3` and `impit` addons on `musl`, then builds the React 19 + Vite 8 + Tailwind v4 frontend bundle (`npm run build` → `/app/dist`).

### Stage 2: `runner` (`node:22-alpine`)
- Leaves build compilers behind; installs lightweight runtime utilities (`curl`, `7zip`, `libstdc++`, `libgcc`, `libarchive-tools` for `bsdtar`, plus the copied `/usr/bin/unrar` binary) and sets `LANG=C.UTF-8` / `LC_ALL=C.UTF-8` so Unicode filenames stream cleanly across extractor subprocesses.
- Creates an unprivileged system user and group (`rgt:rgt`) owning `/run/repo` (`DOWNLOAD_DIR`) and `/run/repo/.rgt-data` (`DATA_DIR`).
- Launches directly via `CMD ["node", "server.ts"]` with a built-in `HEALTHCHECK` against `http://127.0.0.1:3000/healthz`.
- `.dockerignore` excludes `docs/`, `scripts/`, `tests/`, `k8s/`, `deploy/`, and `public/assets/aistudio/` so documentation or screenshot updates never invalidate Docker build layers.

### Build-Time Provenance & Dynamic Source Links
CI injects `GIT_SHA`, `APP_VERSION`, `GIT_URL`, `GIT_REF`, and `BUILT_AT` into both OCI image labels and runtime env vars, surfaced via `status.build` in the sidebar footer with provider-aware links (GitHub, GitLab, Gitea/Forgejo, Bitbucket) or suppressed via `GIT_URL=none`.

---

## 2. GitHub Actions CI/CD

### Release & Container Publishing (`.github/workflows/docker-publish.yml`)
Runs on code pushes to `main`, bare SemVer tag pushes (`[0-9]*.*.*`), pull requests, or `workflow_dispatch` (automatically skipping docs-only, screenshot-tooling, and repo-metadata commits):
1. **Template & Chart Validation (`validate`):** Lints Unraid XML templates (`xmllint --noout`), verifies Docker Compose & TrueNAS Compose files (`docker compose config -q`), and runs `helm lint k8s/charts/retrogametalk-sync`.
2. **Release Validation & Bare-SemVer Tagging (`release`):** Enforces strict `1.x.y` lockstep across `package.json` and `Chart.yaml` (`version` + `appVersion`), mints bare `X.Y.Z` annotated tags, and creates GitHub Releases from `CHANGELOG.md` including a **Published Artifacts** manifest and attached packaged `.tgz` Helm chart asset.
3. **Native Multi-Arch Matrix & Manifest Merge (`build` + `merge`):** Compiles **`linux/amd64`** (`ubuntu-24.04`) and **`linux/arm64`** (`ubuntu-24.04-arm`) natively with zero QEMU emulation, per-arch GHA caches, SBOM, and `provenance: mode=max` attestations. Merges digests into `ghcr.io/<owner>/retrogametalk-sync`, pushes the OCI Helm chart to `oci://ghcr.io/<owner>/charts/retrogametalk-sync`, and mirrors to Docker Hub only when `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN` secrets are configured.

### Zero-Bloat Visual Preview Pipeline (`.github/workflows/update-screenshots.yml`)
Captures fresh animated walkthrough and UI screenshots via Playwright + FFmpeg against an isolated ephemeral demo SQLite library (`npm run capture:screenshots`) and uploads them atomically via `gh release upload readme-assets --clobber` to the rolling `readme-assets` pre-release so binary assets never bloat git history.

For platform-specific homelab install guides (Docker, Compose, Portainer/Dockge, Proxmox LXC, TrueNAS SCALE, Unraid, Kubernetes), see [`/docs/deploy/`](../deploy/README.md).

---

## 3. Kubernetes Architecture (`/k8s/charts/retrogametalk-sync`)

For k3s, Talos, MicroK8s, and cloud Kubernetes clusters, `rgt-sync` ships a Helm chart built around a **`StatefulSet`**:

- **Why a `StatefulSet`?** Guarantees stable pod identity (`POD_ID`), ordered termination (`terminationGracePeriodSeconds: 30`) so `SIGTERM` handlers pause active queues cleanly for automatic startup resumption and unlink transient state without `ReadWriteOnce` PVC multi-attach deadlocks.
- **Post-Install / Upgrade `NOTES.txt` Output:** Displays the deployed application version (`image.tag` or `Chart.AppVersion`), Helm chart version, resolved container image reference, console URL, and health/metrics endpoints right after `helm install` / `helm upgrade`.
- **Two-Tier Configuration & Secrets:**
  - Leave `scraper.*` values empty to manage Sync Rules, Pacing, and Device Export dynamically in SQLite (with secret-free JSON Backup/Restore).
  - Set `credentials.existingSecret` (recommended) or `credentials.*` (`username`, `password`, `encryptionKey`, plus optional self-hosted dashboard lock `appAuthPassword`, `appAuthUsername`, `appAuthSessionSecret`) and `scraper.*` overrides to enforce IaC-locked configuration with visual amber lock indicators in the UI.
- **Horizontal Console Sharding:** Run a single `ReadWriteOnce` pod (`replicaCount: 1`) by default, or deploy console-sharded releases with distinct `scraper.systemFilter` lists against shared `ReadWriteMany` storage coordinated by SQLite `distributed_locks`.

---

## 4. Health Probes & Prometheus Observability

`server.ts` exposes native cloud-native endpoints without sidecar exporters:

- **`GET /healthz` (Liveness Probe):** Lightweight HTTP `200` JSON check verifying event-loop responsiveness.
- **`GET /readyz` (Readiness Probe):** Fast non-blocking cached check verifying SQLite schema readiness and `DOWNLOAD_DIR` writability—returning `503 Service Unavailable` if storage detaches without risking event-loop stalls on large libraries.
- **`GET /metrics` (Prometheus Exposition Format `0.0.4`):** Exports catalog counts by status, mirrored bytes on disk, active run status, sync run counters, and AIMD rate-limiter telemetry (`currentDelayMs`, `avgLatencyMs`, `rateLimitHits`, `totalRequests`) when `metrics.prometheusScrape: true`.
