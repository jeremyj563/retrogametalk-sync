# Deploying with Docker Compose & Podman Compose

This guide covers deploying **RetroGameTalk Sync** using the repository [`docker-compose.yml`](../../docker-compose.yml) and [`.env.example`](../../.env.example) templates on any Docker or Podman Compose host (`linux/amd64` and `linux/arm64`).

---

## 1. Prerequisites

- Docker Engine with Compose plugin (`docker compose version`) **or** `podman-compose`
- Local block/ZFS/array directory for mirrored ROMs and `.rgt-data` state

---

## 2. Step-by-Step Installation

### Step 1: Create a Deployment Directory & Fetch Templates

```bash
mkdir -p rgt-sync && cd rgt-sync

curl -fsSLO https://raw.githubusercontent.com/jeremyj563/retrogametalk-sync/main/docker-compose.yml
curl -fsSL https://raw.githubusercontent.com/jeremyj563/retrogametalk-sync/main/.env.example -o .env
```

*(If you already cloned the repository, work directly from the repo root.)*

### Step 2: Customize `.env` & Volume Path

Edit `.env` to set optional overrides (or leave `RGT_USERNAME` / `RGT_PASSWORD` blank to configure credentials through the web UI):

```dotenv
# Optional: Pin a specific bare SemVer image tag (defaults to :1.7.0 / :latest in docker-compose.yml)
RGT_SYNC_IMAGE=ghcr.io/jeremyj563/retrogametalk-sync:1.7.0

# Optional: Lock credentials via env (leave blank to manage in UI)
RGT_USERNAME=""
RGT_PASSWORD=""

# Optional: Restrict consoles or release types
SCRAPER_SYSTEM_FILTER=""
SCRAPER_RELEASE_TYPE_FILTER=""

# Set to true for verbose diagnostics
SCRAPER_DEBUG="false"
```

By default, `docker-compose.yml` mounts `./mirror-data:/run/repo`. To point ROM storage at a dedicated drive or NAS mount while keeping `.rgt-data` on fast local SSD storage, split the volume mounts:

```yaml
    volumes:
      - /mnt/roms:/run/repo
      - ./rgt-data:/run/repo/.rgt-data
```

> [!IMPORTANT]
> Always keep `/run/repo/.rgt-data` (`DATA_DIR`) on local POSIX storage rather than an SMB/CIFS share so SQLite WAL locking stays reliable.

### Step 3: Start the Stack

```bash
docker compose up -d
```

Check container status and logs:

```bash
docker compose ps
docker compose logs -f rgt-sync
```

Open **`http://localhost:3000`** to verify the CRT control console and inspect `/readyz`.

---

## 3. Building Locally From Source (Optional Override)

The default `docker-compose.yml` pulls prebuilt multi-arch images from GHCR. If you cloned the repository and want to build from local source instead, uncomment `build: .` inside `docker-compose.yml` and run:

```bash
docker compose up -d --build
```

---

## 4. Upgrading & Backups

### Upgrading to a New Release

```bash
# Update RGT_SYNC_IMAGE in .env (if pinned) or pull latest
docker compose pull
docker compose up -d
```

Docker waits up to `stop_grace_period` (`30s`) so in-flight `.part` downloads terminate cleanly and resume cleanly on restart.

### Backing Up State

Your entire catalog history, encrypted credentials, session cookies, and cached covers live inside `.rgt-data/`:

```bash
# Safe SQLite hot-backup snapshot or quiet backup
docker compose stop rgt-sync
tar -czf rgt-data-backup-$(date +%F).tar.gz ./mirror-data/.rgt-data
docker compose start rgt-sync
```

---

## 5. Troubleshooting

- **Permission denied writing to `./mirror-data`:** Ensure the host bind directory is writable by the container `rgt` user (or create the folder and set matching UID/GID ownership before starting).
- **SELinux (`podman-compose` on Fedora/RHEL):** Append `:Z` to volume lines in `docker-compose.yml` (`- ./mirror-data:/run/repo:Z`).
- **UI fields appear locked:** Check `.env`—any non-empty variable defined in `environment:` locks the corresponding setting in the web UI until cleared and recreated (`docker compose up -d`).
