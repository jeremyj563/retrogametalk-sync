# Deploying with Docker CLI, Docker Desktop, Rancher Desktop & Podman

This guide covers single-container deployments using `docker`, **Docker Desktop**, **Rancher Desktop**, or **`podman`** on `linux/amd64` and `linux/arm64` hosts (including Apple Silicon, Raspberry Pi 4/5, and x86 homelab servers).

---

## 1. Prerequisites

- Docker Engine / Docker Desktop / Rancher Desktop, **or** Podman (`4.0+`)
- A dedicated host directory for mirrored ROMs and `.rgt-data` state (e.g., `~/rgt-mirror`)
- An active `retrogametalk.com` account (entered in the web UI after launch or passed via environment variables)

---

## 2. Quick Launch (`docker run` / `podman run`)

### Linux & macOS (Docker Engine / Docker Desktop / Rancher Desktop)

```bash
mkdir -p ./mirror-data

docker run -d \
  --name rgt-sync \
  --restart unless-stopped \
  -p 3000:3000 \
  -e PORT=3000 \
  -e DATA_DIR=/run/repo/.rgt-data \
  -e DOWNLOAD_DIR=/run/repo \
  -v "$(pwd)/mirror-data:/run/repo" \
  ghcr.io/jeremyj563/retrogametalk-sync:1.7.0
```

### Fedora, RHEL, CentOS & Rootless Podman (SELinux `:Z`)

On SELinux-enforcing distributions, append `:Z` to the volume mount so the unprivileged `rgt` container user can read and write `/run/repo`:

```bash
mkdir -p ./mirror-data

podman run -d \
  --name rgt-sync \
  --restart unless-stopped \
  -p 3000:3000 \
  -e PORT=3000 \
  -e DATA_DIR=/run/repo/.rgt-data \
  -e DOWNLOAD_DIR=/run/repo \
  -v "$(pwd)/mirror-data:/run/repo:Z" \
  ghcr.io/jeremyj563/retrogametalk-sync:1.7.0
```

> [!TIP]
> **Podman Rootless Ownership:** If `./mirror-data` is owned by your host user (`1000:1000`) while the container runs as the Alpine `rgt` user, Podman rootless users can use `--userns=keep-id` or inspect the exact container UID/GID first with `docker run --rm --entrypoint id ghcr.io/jeremyj563/retrogametalk-sync:1.7.0` and `chown` the directory accordingly.

### GUI Setup (Docker Desktop / Rancher Desktop / Podman Desktop)

1. Pull **`ghcr.io/jeremyj563/retrogametalk-sync:1.7.0`** (or `:latest` for tracking `main`).
2. Click **Run** and expand **Optional Settings**:
   - **Container Name:** `rgt-sync`
   - **Ports:** Host port `3000` → Container port `3000`
   - **Volumes:** Host path (your ROM directory) → Container path **`/run/repo`**
   - **Environment Variables:** Optional (`RGT_USERNAME`, `RGT_PASSWORD`, `CRON_SCHEDULE`, `SCRAPER_SYSTEM_FILTER`) — see [`docs/deploy/README.md`](./README.md#complete-environment-variable-reference).

---

## 3. Optional Headless Pre-Configuration

To pre-populate and lock credentials or schedules from the CLI instead of setting them in the browser:

```bash
docker run -d \
  --name rgt-sync \
  --restart unless-stopped \
  -p 3000:3000 \
  -e RGT_USERNAME="your-username" \
  -e RGT_PASSWORD="your-password" \
  -e CRON_SCHEDULE="0 */6 * * *" \
  -e SCRAPER_SCHEDULE_ENABLED="true" \
  -e SCRAPER_SYSTEM_FILTER="snes,gba,psx" \
  -v "/srv/rgt-mirror:/run/repo" \
  ghcr.io/jeremyj563/retrogametalk-sync:1.7.0
```

> [!NOTE]
> Any parameter passed as a container environment variable shows a **Lock** indicator in the UI and cannot be overwritten from the browser until removed from the container environment.

---

## 4. Verification, Logs & Health Checks

```bash
# Check container healthcheck status
docker ps --filter name=rgt-sync

# Verify readiness probe (confirms SQLite + writable /run/repo)
curl -fsS http://127.0.0.1:3000/readyz

# Tail live application logs
docker logs -f rgt-sync
```

Open **`http://localhost:3000`** in your browser to access the RetroGameTalk Sync CRT console.

---

## 5. Upgrading & Rollback

```bash
# Pull the target release tag (bare SemVer, e.g. 1.7.0 -> 1.7.1)
docker pull ghcr.io/jeremyj563/retrogametalk-sync:1.7.0

# Gracefully stop (allows active .part downloads up to termination grace window to clean up)
docker stop -t 30 rgt-sync
docker rm rgt-sync

# Re-run with the same /run/repo volume mount; SQLite migrations apply automatically at startup
```

Because `/run/repo/.rgt-data/scraper.db` tracks applied SQLite migrations automatically and active Range downloads persist `.part.meta.json` resume metadata, upgrading or recreating the container preserves your catalog, cookies, and partial downloads.

---

## 6. Troubleshooting

- **`DOWNLOAD_DIR not writable` on `/readyz`:** Verify host directory permissions match the container `rgt` UID/GID (`docker run --rm --entrypoint id ghcr.io/jeremyj563/retrogametalk-sync:1.7.0`), or add `:Z` on SELinux hosts.
- **Direct-to-SD-Card Exporter button unavailable in browser:** Chromium-based browsers require a **Secure Context** (`http://localhost:3000`, `http://127.0.0.1:3000`, or `https://...`) for the File System Access API (`showDirectoryPicker`). When accessing over a LAN IP (e.g., `http://192.168.1.50:3000`), place `rgt-sync` behind HTTPS (Tailscale Serve, Caddy, Traefik, or Nginx) to unlock direct SD card writes, or use single-file / prepared ROM downloads directly.
- **Need Docker Hub instead of GHCR?** <!-- TODO: Document docker.io/<username>/retrogametalk-sync image path once DOCKERHUB_USERNAME and DOCKERHUB_TOKEN secrets are activated --> Docker Hub mirroring is opt-in; use `ghcr.io/jeremyj563/retrogametalk-sync` directly in the meantime.
