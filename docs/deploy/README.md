# Deployment Hub & Canonical Container Contract

This directory contains self-contained deployment guides for running **RetroGameTalk Sync** (`rgt-sync`) across container runtimes, Compose UIs, NAS appliances, hypervisors, and Kubernetes clusters.

---

## 1. Platform Selection Matrix

| Platform | Guide | Recommended For | Persistence Model | Architecture |
| :--- | :--- | :--- | :--- | :--- |
| **Docker / Podman CLI** | [`docker.md`](./docker.md) | Desktop evaluation, single Linux VMs, Podman rootless hosts | Single bind mount (`:/run/repo`) or named volume | `linux/amd64`, `linux/arm64` |
| **Docker / Podman Compose** | [`docker-compose.md`](./docker-compose.md) | Version-controlled single-host homelabs, `.env` overrides | Single bind mount (`./mirror-data:/run/repo`) | `linux/amd64`, `linux/arm64` |
| **Portainer & Dockge** | [`portainer-and-dockge.md`](./portainer-and-dockge.md) | Web UI Stack editors and Git-backed Compose redeployments | Host bind mount or NAS NFS/CIFS volume | `linux/amd64`, `linux/arm64` |
| **Proxmox VE (LXC)** | [`proxmox-lxc.md`](./proxmox-lxc.md) | Proxmox 9.1+ Native OCI LXCs and Docker-in-LXC guests | Host bind mount point (`mp0`) detached from LXC rootfs | `linux/amd64`, `linux/arm64` |
| **TrueNAS SCALE (CE)** | [`truenas-scale.md`](./truenas-scale.md) | Electric Eel (24.10+) native Docker Apps via ZFS datasets | Separate datasets for `.rgt-data` (apps SSD) & ROMs (pool) | `linux/amd64` |
| **Unraid** | [`unraid.md`](./unraid.md) | Unraid servers using NVMe `appdata` cache + Array ROM shares | `/mnt/user/appdata/rgt-sync` + `/mnt/user/roms` | `linux/amd64` |
| **Kubernetes & Helm** | [`kubernetes-helm.md`](./kubernetes-helm.md) | k3s, Talos, MicroK8s, Ingress + Secret + Prometheus clusters | `StatefulSet` PVC (`ReadWriteOnce` or sharded `ReadWriteMany`) | `linux/amd64`, `linux/arm64` |

---

## 2. Available Container Images & Registries

| Registry | Image Reference | Release Cadence |
| :--- | :--- | :--- |
| **GitHub Container Registry (Primary)** | `ghcr.io/jeremyj563/retrogametalk-sync` | Every push to `main` (`latest`, `main`, `sha-<short>`) and bare SemVer release (`1.7.0`, `1.7`). |
| **GHCR OCI Helm Chart** | `oci://ghcr.io/jeremyj563/charts/retrogametalk-sync` | Packaged and pushed automatically on bare SemVer releases (`1.7.0`). |
| **Docker Hub (Opt-In Mirror)** | `<!-- TODO: Add <dockerhub_user>/retrogametalk-sync once DOCKERHUB_USERNAME/TOKEN secrets are configured -->` | Pushed **only** on tagged SemVer releases when maintainer secrets are configured. |

> [!NOTE]
> **Bare SemVer Tags:** All releases, container tags, and Helm charts follow strict **`1.x.y`** bare semantic versions (e.g., `1.7.0`, without a leading `v` prefix).

---

## 3. Canonical Storage & Persistence Contract

The container runs as an unprivileged user (`rgt:rgt`) and expects persistent storage under `/run/repo`:

```text
/run/repo                         <-- DOWNLOAD_DIR (mirrored <system>/<release>/<files>)
└── .rgt-data/                    <-- DATA_DIR (hidden from filesystem scans & catalog trees)
    ├── scraper.db                <-- SQLite database (WAL mode: scraper.db-wal / scraper.db-shm)
    ├── .keyfile                  <-- Auto-generated AES-256-GCM key (if ENCRYPTION_KEY unset)
    ├── cookies.json              <-- Authenticated RetroGameTalk session jar
    └── cache/
        ├── covers/               <-- Lazy catalog cover thumbnails for un-downloaded releases
        └── screenshots/          <-- Lazy release screenshots hydrated on item inspection
```

### Single-Mount vs. Split-Mount Storage

- **Single-Mount (Simplest — Default in Docker, Compose, Portainer, Kubernetes):** Mount one host folder or PVC to `/run/repo`. `DATA_DIR` automatically lives inside `/run/repo/.rgt-data`, so backups and upgrades preserve both ROMs and catalog state together.
- **Split-Mount (Recommended on Unraid & TrueNAS ZFS):** Keep `DOWNLOAD_DIR=/run/repo` on your large media array/pool and mount fast NVMe/SSD storage at `/run/repo/.rgt-data` (`DATA_DIR=/run/repo/.rgt-data`) so SQLite WAL writes stay snappy and array drives can spin down between syncs.

> [!IMPORTANT]
> **SQLite & Network Shares:** SQLite in WAL mode requires POSIX file locking (`fcntl`) and performs poorly or risks corruption over high-latency SMB/CIFS shares. Always place `DATA_DIR` (`/run/repo/.rgt-data`) on local block storage, NVMe `appdata`, or local ZFS datasets—even if `DOWNLOAD_DIR` writes ROM archives onto a network share.

---

## 4. Health Probes, Ports & Metrics

| Endpoint / Port | Purpose | Expected Response |
| :--- | :--- | :--- |
| **`3000/tcp`** (`PORT`) | Web CRT Console, REST API, and SSE stream (`/api/events`) | HTML UI & JSON APIs |
| **`GET /healthz`** | Container / Pod Liveness Probe | `200 OK` JSON (`{ "status": "ok" }`) |
| **`GET /readyz`** | Container / Pod Readiness Probe (checks SQLite + writable `DOWNLOAD_DIR`) | `200 OK` when writable; `503 Service Unavailable` if storage detaches |
| **`GET /metrics`** | Prometheus Exposition Format (`0.0.4`) | Catalog counts, mirrored bytes, active run gauges, AIMD rate-limit metrics |

---

## 5. Complete Environment Variable Reference

Settings omitted from the environment default cleanly and remain editable in the web UI (**Sync Rules**, **Device Export**, and **System Settings**). Explicitly defining a variable below **locks** that field in the UI (`envLocks`) so Infrastructure-as-Code configs are never silently overwritten.

### Core Service & Storage

| Variable | Default | Description |
| :--- | :--- | :--- |
| `PORT` | `3000` | HTTP listen port inside the container. |
| `DOWNLOAD_DIR` | `/run/repo` | Root folder where mirrored console/release directories are stored. |
| `DATA_DIR` | `/run/repo/.rgt-data` | Folder containing SQLite DB, `.keyfile`, cookies, and lazy metadata caches. |
| `ENCRYPTION_KEY` | Auto `.keyfile` | Passphrase (`>=16` chars) hashed via SHA-256 into the AES-256-GCM credential key. |
| `GIT_URL` | Built-in repo URL | Base repository URL linked in the UI footer; set `"none"` to hide footer source links. |

### RetroGameTalk Authentication & Endpoints

| Variable | Default | Description |
| :--- | :--- | :--- |
| `RGT_USERNAME` | `""` | RetroGameTalk account username (locks UI username input when non-empty). |
| `RGT_PASSWORD` | `""` | RetroGameTalk account password (locks UI password input when non-empty). |
| `RGT_BASE_URL` | `https://retrogametalk.com/repo/` | Repository root URL used for scraping and WP REST catalog discovery. |
| `RGT_LOGIN_URL` | `https://retrogametalk.com/login/` | XenForo authentication URL. |
| `SCRAPER_USER_AGENT` | Chrome desktop UA | Custom HTTP `User-Agent` header override. |

### Scheduling & Filtering

| Variable | Default | Description |
| :--- | :--- | :--- |
| `SCRAPER_SCHEDULE_ENABLED` | `false` *(UI-managed)* | Set `"true"` or `"false"` to lock automatic cron scheduling on or off. |
| `CRON_SCHEDULE` | `"0 */6 * * *"` | 5-field cron schedule (e.g., `"0 */6 * * *"`, `"30 3 * * *"`). |
| `SCRAPER_SYSTEM_FILTER` | `""` | Comma-separated canonical console slugs (e.g., `"snes,gba,psx"`). Empty mirrors/indexes all enabled consoles. |
| `SCRAPER_RELEASE_TYPE_FILTER` | `""` | Comma-separated release tags (e.g., `"Retail ROM,Translation,Hack,Homebrew"`). |
| `SCRAPER_AUTO_DOWNLOAD_NEW_RELEASES` | `true` *(UI-managed)* | Set `"true"` for Auto-Download during syncs or `"false"` for Index-Only discovery. |

### Traffic Shaping & Multi-Chunk Acceleration

| Variable | Default | Description |
| :--- | :--- | :--- |
| `SCRAPER_BASE_DELAY_MS` | `1500` *(UI-managed)* | Base inter-request pacing delay (ms). |
| `SCRAPER_MIN_DELAY_MS` | `750` *(UI-managed)* | Minimum AIMD delay floor after consecutive successes (ms). |
| `SCRAPER_MAX_DELAY_MS` | `60000` *(UI-managed)* | Maximum backoff delay cap during rate-limit recovery (ms). |
| `SCRAPER_BACKOFF_MULTIPLIER` | `2` *(UI-managed)* | Multiplicative backoff factor on `429`/`503` responses. |
| `SCRAPER_MAX_RETRIES` | `4` *(UI-managed)* | Maximum retry attempts per failed HTTP request. |
| `SCRAPER_MAX_CONCURRENCY` | `1` *(UI-managed)* | Parallel release download workers. Keep low (`1`–`2`) to respect upstream mirrors. |
| `SCRAPER_DOWNLOAD_CHUNK_CONCURRENCY` | `1` *(UI-managed)* | Concurrent HTTP `Range` streams per large archive (`>=1`). |
| `SCRAPER_DOWNLOAD_CHUNK_MIN_SIZE_MB` | `32` *(UI-managed)* | Minimum archive size (MiB) before segmented `Range` transfers engage. |
| `SCRAPER_REQUEST_TIMEOUT_MS` | `45000` *(UI-managed)* | Request timeout (ms). |

### Diagnostics & Logging

| Variable | Default | Description |
| :--- | :--- | :--- |
| `SCRAPER_DEBUG` | `"false"` | Set `"true"` to enable verbose scrape, HTTP, download, archive, and SD-install logs. |
| `LOG_LEVEL` | `info` | Alternative debug trigger (`LOG_LEVEL=debug`, or `RGT_DEBUG=true` / `DEBUG_LOGGING=true`). |
