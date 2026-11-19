# Containerization, CI/CD, Kubernetes Helm Chart & Observability

This document covers how `rgt-sync` is packaged, built, deployed, scaled, and monitored in production environments (`Dockerfile`, `docker-compose.yml`, `.github/workflows/docker-publish.yml`, and `/k8s/charts/retrogametalk-sync`).

---

## 1. Multi-Stage Alpine Container (`Dockerfile`)

`rgt-sync` uses a two-stage `node:22-alpine` build designed to compile native C++/Rust Node addons cleanly while keeping the runtime container lean and non-root.

### Stage 1: `builder` (`node:22-alpine`)
- Installs build-time toolchain packages (`python3`, `make`, `g++`) required when `npm ci` compiles or verifies native N-API bindings (`better-sqlite3`, `impit`) on `musl` libc.
- Compiles the React 19 + Tailwind v4 frontend bundle (`npm run build` → `/app/dist`).

### Stage 2: `runner` (`node:22-alpine`)
- Leaves `python3`, `make`, and `g++` behind; installs only lightweight runtime utilities (`curl`, `7zip` for fast native `.7z`/`.rar`/`.zip` streaming, plus BusyBox `wget` for local health checks).
- Creates an unprivileged system user and group (`rgt:rgt`) and pre-owns `/run/repo` (`DOWNLOAD_DIR`) and `/run/repo/.rgt-data` (`DATA_DIR`).
- Copies `/app/dist`, `node_modules`, `server.ts`, `src/server`, `src/shared`, and `tsconfig.json`, launching directly via `CMD ["node", "server.ts"]`.
- **Single-Mount State Design**: By placing `DATA_DIR` (`/run/repo/.rgt-data`) inside `DOWNLOAD_DIR` (`/run/repo`) while automatically hiding `.rgt-data` from filesystem tree listings and system scans, operators only have to mount **one volume** (`/run/repo`) to persist mirrored ROMs, box art, `scraper.db` (+ WAL), `.keyfile`, and `cookies.json` together.

### Build-Time Provenance & Dynamic Source Links
The `Dockerfile` accepts three build arguments injected automatically by CI:
- `ARG GIT_SHA` → `ENV GIT_SHA` & `org.opencontainers.image.revision`
- `ARG APP_VERSION` → `ENV APP_VERSION` & `org.opencontainers.image.version`
- `ARG GIT_URL` → `ENV GIT_URL` & `org.opencontainers.image.source`

At runtime, `ScraperOrchestrator` exposes `status.build` (`{ version, gitSha, gitUrl }`)—falling back to local `git` CLI inspection in dev environments—and the sidebar footer dynamically links the displayed branch/tag and short commit SHA to the upstream Git repository (GitHub, GitLab, Gitea/Forgejo, or Bitbucket) whenever `GIT_URL` is set.

---

## 2. GitHub Actions CI/CD (`.github/workflows/docker-publish.yml`)

Every push to `main`, bare SemVer tag push (`[0-9]*.*.*`), pull request, or manual `workflow_dispatch` runs the automated container and validation pipeline on `ubuntu-24.04`:
1. **Template & Chart Validation (`validate`)**: Lints Unraid XML templates (`xmllint --noout`), verifies Docker Compose and TrueNAS Compose configs (`docker compose config -q`), and runs `helm lint k8s/charts/retrogametalk-sync`.
2. **Release Validation & Bare-SemVer Tagging (`release`)**: Confirms strict `1.x.y` lockstep between `package.json` and `Chart.yaml` (`version` + `appVersion`), mints bare `X.Y.Z` annotated tags, and creates GitHub Releases from `CHANGELOG.md`.
3. **Multi-Arch Buildx, Attestations & Registry Gating (`build-and-push`)**: Builds **`linux/amd64,linux/arm64`** images using QEMU + Buildx (`type=gha,mode=max` cache) with OCI labels, SBOM, and `provenance: mode=max` attestations, pushes to **GHCR** (`ghcr.io/<owner>/retrogametalk-sync`), packages/pushes the Helm chart to **`oci://ghcr.io/<owner>/charts/retrogametalk-sync`** on tagged releases, and mirrors to **Docker Hub** only when `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN` secrets are present.

For platform-specific homelab install guides (Docker, Compose, Portainer/Dockge, Proxmox LXC, TrueNAS SCALE, Unraid, Kubernetes), see [`/docs/deploy/`](../deploy/README.md).

---

## 3. Kubernetes Architecture (`/k8s/charts/retrogametalk-sync`)

For home-lab and cluster deployments (k3s, Talos, MicroK8s, EKS/GKE), `rgt-sync` ships a production-ready Helm chart built around a **StatefulSet**.

### Why a `StatefulSet` Instead of a `Deployment`?
- `rgt-sync` performs stateful SQLite WAL writes and multi-gigabyte sequential file downloads onto a `PersistentVolumeClaim`. Using a `Deployment` with default `RollingUpdate` on a `ReadWriteOnce` PVC causes multi-attach volume deadlocks when a new pod schedules onto a different node before the old pod releases the block device, or causes two pods to write to the same SQLite WAL concurrently.
- A `StatefulSet` provides stable pod identity (`POD_ID` surfaced in UI telemetry and distributed locks), predictable ordered termination, and a `30s` `terminationGracePeriodSeconds` window so `SIGTERM` handlers cleanly abort active downloads, unlink `.part` files, release SQLite locks, and checkpoint cleanly.

### Configuration Precedence & Environment Locking
Configuration supports a clean two-tier hierarchy:
1. **UI / SQLite Dynamic Configuration**: By default, Helm values for rate limits, cron schedule, and console filters are empty strings (`""`), allowing operators to adjust settings live in the **Operations** and **Schedule** UI with persistence in `scraper_config`.
2. **Environment Lock Overrides (`ConfigMap` & `Secret`)**: Whenever an environment variable (`RGT_USERNAME`, `RGT_PASSWORD`, `CRON_SCHEDULE`, `SCRAPER_SYSTEM_FILTER`, `GIT_URL`, `RATE_LIMIT_*`, etc.) is explicitly set via Docker Compose or Helm `values.yaml` (`credentials.*` / `scraper.*`), the backend enforces that value as authoritative and exposes `envLocks` in `GET /api/config`—rendering visual lock indicators (`EnvLockIndicator`) in the UI so operators never wonder why an IaC-managed setting cannot be overwritten in-browser.
   - Notably, `scraper.gitUrl` supports three states: `""` (inherit image's built-in `GIT_URL`), a custom URL string (override for forks/mirrors), or `"none"` / `"false"` (explicitly suppress footer Git links).

### Horizontal Sharding Strategy
- **Single-Pod (`ReadWriteOnce`)**: Recommended default (`replicaCount: 1`) mirroring all selected consoles onto one PVC.
- **Console-Sharded Pods**: Operators mirroring massive multi-terabyte optical sets can deploy multiple Helm releases or pods with distinct `scraper.systemFilter` lists (e.g., Cartridge Pod vs. Optical Disc Pod), coordinated safely on shared `ReadWriteMany` storage via the SQLite `distributed_locks` lease table.

---

## 4. Health Probes & Prometheus Observability

`server.ts` exposes first-class cloud-native telemetry without sidecar exporters:

- **`GET /healthz` (Liveness Probe)**: Lightweight HTTP `200` JSON check verifying the Node.js event loop is responsive.
- **`GET /readyz` (Readiness Probe)**: Verifies SQLite schema readiness and confirms `DOWNLOAD_DIR` is physically mounted and writable—returning `503 Service Unavailable` if the underlying NFS/SMB/CSI volume drops offline so Kubernetes stops routing traffic and alerts immediately.
- **`GET /metrics` (Prometheus Exposition Format `0.0.4`)**: Exports gauge and counter metrics scraped automatically when `metrics.prometheusScrape: true` adds `prometheus.io/scrape` pod annotations:
  - Catalog totals by status (`downloaded`, `queued`, `failed`, `skipped`) and total mirrored bytes on disk
  - Active run status, sync run counters, and rate-limiter telemetry (`currentDelayMs`, `avgLatencyMs`, `rateLimitHits`, `totalRequests`)
