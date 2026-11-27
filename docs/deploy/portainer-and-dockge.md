# Deploying with Portainer & Dockge

Both **Portainer** and **Dockge** let you deploy and manage **RetroGameTalk Sync** cleanly through a browser UI using standard Docker Compose YAML. Choose whichever stack workflow fits your homelab.

---

## 1. Option A — Portainer (Stack Web Editor or GitOps)

### Method 1: Paste Stack YAML in Portainer UI

1. In Portainer, navigate to **Environments → `<your-host>` → Stacks → + Add stack**.
2. Set **Name** to `rgt-sync`.
3. Under **Build method**, choose **Web editor** and paste:

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
      PORT: 3000
      DATA_DIR: /run/repo/.rgt-data
      DOWNLOAD_DIR: /run/repo
      CRON_SCHEDULE: "0 */6 * * *"
      RGT_USERNAME: "${RGT_USERNAME:-}"
      RGT_PASSWORD: "${RGT_PASSWORD:-}"
      SCRAPER_SYSTEM_FILTER: "${SCRAPER_SYSTEM_FILTER:-}"
      SCRAPER_RELEASE_TYPE_FILTER: "${SCRAPER_RELEASE_TYPE_FILTER:-}"
      SCRAPER_DEBUG: "${SCRAPER_DEBUG:-false}"
    volumes:
      - /srv/rgt-sync/roms:/run/repo
      - /srv/rgt-sync/data:/run/repo/.rgt-data
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://127.0.0.1:3000/healthz"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s
```

4. *(Optional)* Add environment variables (`RGT_USERNAME`, `RGT_PASSWORD`, `ENCRYPTION_KEY`) in Portainer's **Environment variables** section below the editor, or leave them empty and sign in via the web UI.
5. Click **Deploy the stack** and open `http://<portainer-host>:3000`.

### Method 2: Git-Backed Auto-Updating Stack

1. Choose **Repository** as the Portainer Stack build method.
2. Enter:
   - **Repository URL:** `https://github.com/jeremyj563/retrogametalk-sync`
   - **Repository reference:** `refs/heads/main`
   - **Compose path:** `docker-compose.yml`
3. *(Optional)* Enable **GitOps updates** (polling or webhook) so Portainer tracks upstream Compose template changes automatically.
4. Override the volume path if needed using Portainer's **Additional paths** or by maintaining your own fork/environment variables.

### Upgrading in Portainer

Open **Stacks → `rgt-sync` → Editor → Update the stack**, bump the image tag (e.g., `1.44.3` → `1.44.4`) or toggle **Re-pull image and redeploy**.

---

## 2. Option B — Dockge

Dockge stores Compose stacks directly on disk (typically `/opt/stacks/<stack-name>/compose.yaml`) with live terminal logs and `.env` editing.

### Step 1: Create the Stack

1. Click **+ Compose** in Dockge.
2. Set **Stack Name** to `rgt-sync`.
3. Paste the Compose YAML above into the editor (adjusting `/srv/rgt-sync/...` host paths to match your server).
4. In Dockge's **Environment Variables** box, add any overrides you want locked at startup:
   ```dotenv
   RGT_USERNAME=
   RGT_PASSWORD=
   SCRAPER_SYSTEM_FILTER=
   SCRAPER_DEBUG=false
   ```
5. Click **Deploy**.

### Upgrading in Dockge

Click **Update** on the `rgt-sync` stack card (or bump the image version tag in the Compose YAML and click **Save & Deploy**).

---

## 3. Reverse Proxy & SSE Streaming Notes

Because `rgt-sync` streams real-time transfer progress, logs, and status updates over **Server-Sent Events (`GET /api/events`)** and exposes the browser File System Access API for direct SD card writes (which requires HTTPS on non-localhost URLs):

- Put `rgt-sync` behind HTTPS (**Nginx Proxy Manager**, **Traefik**, **Caddy**, or **Tailscale Serve**) when accessing over your LAN/WAN.
- **Disable proxy response buffering** on `/api/events` so live progress bars do not stall:
  - **Nginx / Nginx Proxy Manager (Custom Location `/api/events` or Advanced config):**
    ```nginx
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 3600s;
    ```
  - **Caddy:** Works out of the box (`reverse_proxy rgt-sync:3000` disables buffering for `text/event-stream` automatically).
