# Deploying on TrueNAS SCALE (Community Edition / Electric Eel 24.10+)

Starting with **TrueNAS SCALE *Electric Eel* (24.10)** and **Community Edition**, TrueNAS uses native **Docker Engine + Docker Compose** for applications, making **RetroGameTalk Sync** immediately deployable via **Custom App (`Install via YAML`)** with our staged template [`deploy/truenas/docker-compose.yaml`](../../deploy/truenas/docker-compose.yaml).

---

## 1. Prepare TrueNAS ZFS Datasets

Create two datasets (using **Apps** preset for SQLite state, and **Generic** for ROM archives) so SQLite WAL metadata lives on your fastest NVMe/SSD apps pool while large ROMs live on bulk storage:

1. Open **Datasets** in TrueNAS UI:
   - **`<apps-pool>/apps/rgt-sync/data`** — Share Type: **Apps** (for `/run/repo/.rgt-data`, `scraper.db`, cookies, cover cache)
   - **`<media-pool>/roms`** — Share Type: **Generic** or **SMB** (for `/run/repo`, mirrored `<system>/<release>` directories)
2. Verify permissions on both datasets:
   - Check the container's runtime UID/GID (`rgt:rgt`) or assign `apps` (`568`) / explicit user ownership matching your container environment, ensuring `rgt-sync` can read and write both datasets.
   - If you share `<media-pool>/roms` over SMB so retro handhelds or desktop emulators can browse it read-only, keep `<apps-pool>/apps/rgt-sync/data` **excluded** from SMB sharing so SQLite WAL files stay purely local.

---

## 2. Stage A — Immediate Install via Custom App YAML

1. In the TrueNAS UI, navigate to **Apps → Discover Apps**.
2. Click the **`...` menu (or `Custom App`) → Install via YAML**.
3. Set **Application Name** to `rgt-sync`.
4. Paste the contents of [`deploy/truenas/docker-compose.yaml`](../../deploy/truenas/docker-compose.yaml), replacing `<apps-pool>` and `<media-pool>` with your real ZFS dataset paths:

```yaml
services:
  rgt-sync:
    image: ghcr.io/jeremyj563/retrogametalk-sync:1.44.4
    container_name: rgt-sync
    restart: unless-stopped
    stop_grace_period: 30s
    ports:
      - "3000:3000"
    environment:
      NODE_ENV: production
      PORT: "3000"
      DATA_DIR: /run/repo/.rgt-data
      DOWNLOAD_DIR: /run/repo
      CRON_SCHEDULE: "0 */6 * * *"
      SCRAPER_DEBUG: "false"
    volumes:
      - type: bind
        source: /mnt/<media-pool>/roms
        target: /run/repo
      - type: bind
        source: /mnt/<apps-pool>/apps/rgt-sync/data
        target: /run/repo/.rgt-data
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://127.0.0.1:3000/healthz"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s
```

5. Click **Save**. Once the app enters **Running** status, open **`http://<truenas-ip>:3000`**.

---

## 3. Upgrading & Dataset Snapshots

- **Upgrading:** Open **Apps → `rgt-sync` → Edit**, bump the image tag (e.g., `1.44.3` → `1.44.4`) in the YAML, and save. Active `.part` downloads and interrupted download queues resume cleanly on startup.
- **Snapshots:** Schedule ZFS snapshots on `<apps-pool>/apps/rgt-sync/data` for instant point-in-time rollbacks of your SQLite database before major experiments.

---

## 4. Stage B — Future Official `truenas/apps` Community Train Readiness

<!-- TODO: Complete and open upstream PR to github.com/truenas/apps under ix-dev/community/retrogametalk-sync/ once volume paths, env vars, and LICENSE are finalized -->

When ready to submit RetroGameTalk Sync to the official TrueNAS Community catalog (`github.com/truenas/apps`):

- [ ] Confirm OSI `LICENSE` file exists at repository root
- [ ] Fork `truenas/apps` and create `ix-dev/community/retrogametalk-sync/` with:
  - `app.yaml`, `ix_values.yaml`, `questions.yaml`, `templates/docker-compose.yaml`, `README.md`, and `templates/test_values/basic-values.yaml`
- [ ] Validate against TrueNAS `ci.py` test runner before opening the upstream PR
- [ ] Link `docs/assets/icon.svg` (or PNG app icon) in `app.yaml`

---

## 5. Troubleshooting

- **App stuck in Deploying (`DOWNLOAD_DIR not writable` in logs):** Verify ZFS dataset ACL/POSIX permissions allow the container `rgt` user to create directories in `/mnt/<media-pool>/roms` and `/mnt/<apps-pool>/apps/rgt-sync/data`.
- **Browser refuses Direct SD Card Export over HTTP LAN IP:** Expose TrueNAS `rgt-sync` via HTTPS (TrueNAS Nginx/Traefik/Tailscale reverse proxy) or open via `https://...` so Chromium enables `window.showDirectoryPicker`.
