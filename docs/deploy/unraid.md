# Deploying on Unraid

**RetroGameTalk Sync** pairs naturally with Unraid's storage architecture: place `.rgt-data` (SQLite WAL + session cookies + lazy metadata cache) on fast NVMe **`appdata`** so array parity drives can spin down, while writing mirrored ROM archives directly to an Unraid **`roms`** share.

---

## 1. Recommended Share Layout

1. **`/mnt/user/appdata/rgt-sync`** → Mounted to `/run/repo/.rgt-data` (`DATA_DIR`)
   - Set **Primary storage** to your **NVMe / SSD Cache** pool (`Cache: Only` or `Prefer`) so SQLite database writes stay fast and responsive.
2. **`/mnt/user/roms`** (or your existing emulator share) → Mounted to `/run/repo` (`DOWNLOAD_DIR`)
   - Can span your Unraid Array cleanly; `.rgt-data` stays hidden from filesystem tree views and SMB shares.

---

## 2. Option A — Install via Staged Unraid XML Template *(Fastest)*

A ready-to-test `Container version="2"` template is staged in this repository at [`deploy/unraid/retrogametalk-sync.xml`](../../deploy/unraid/retrogametalk-sync.xml).

### Test Locally via Docker Template Repositories

1. In the Unraid Web UI, open **Docker → Template Repositories** *(bottom of the Docker page, or copy the XML file directly to `/boot/config/plugins/dockerMan/templates-user/my-retrogametalk-sync.xml`)*.
2. Add the repository template directory (or open **Docker → Add Container** and choose `retrogametalk-sync` from the template dropdown).
3. Review the pre-filled paths and optional variables:
   - **WebUI:** `http://[IP]:[PORT:3000]`
   - **Console Port (`3000`):** `3000`
   - **Mirrored ROMs (`DOWNLOAD_DIR` → `/run/repo`):** `/mnt/user/roms`
   - **App State & SQLite (`DATA_DIR` → `/run/repo/.rgt-data`):** `/mnt/user/appdata/rgt-sync`
4. Click **Apply**.

---

## 3. Option B — Manual Unraid **Add Container** Setup

If adding the container manually without the XML template:

1. Go to **Docker → Add Container** and click **Basic / Advanced View**.
2. Configure:
   - **Name:** `retrogametalk-sync`
   - **Repository:** `ghcr.io/jeremyj563/retrogametalk-sync:1.44.4`
   - **Network Type:** `bridge` *(or custom Docker network if using Swag/Nginx Proxy Manager/Traefik)*
   - **WebUI:** `http://[IP]:[PORT:3000]`
   - **Icon URL:** `https://raw.githubusercontent.com/jeremyj563/retrogametalk-sync/main/docs/assets/icon.svg` <!-- TODO: Confirm PNG vs SVG compatibility with your target Unraid OS / CA portal version and replace if needed -->
3. Add **Port**, **Path**, and **Variable** entries:

| Type | Name | Container Target | Host Value / Default | Required |
| :--- | :--- | :--- | :--- | :--- |
| **Port** | Web Console | `3000` | `3000` | Yes |
| **Path** | ROM Mirror Root | `/run/repo` | `/mnt/user/roms` | Yes |
| **Path** | Appdata & SQLite | `/run/repo/.rgt-data` | `/mnt/user/appdata/rgt-sync` | Yes |
| **Variable** | `DATA_DIR` | `DATA_DIR` | `/run/repo/.rgt-data` | Yes |
| **Variable** | `DOWNLOAD_DIR` | `DOWNLOAD_DIR` | `/run/repo` | Yes |
| **Variable** | `RGT_USERNAME` | `RGT_USERNAME` | *(Optional — leave blank to set in UI)* | No |
| **Variable** | `RGT_PASSWORD` | `RGT_PASSWORD` | *(Optional — leave blank to set in UI)* | No |
| **Variable** | `CRON_SCHEDULE` | `CRON_SCHEDULE` | `0 */6 * * *` | No |
| **Variable** | `SCRAPER_SYSTEM_FILTER` | `SCRAPER_SYSTEM_FILTER` | *(Optional comma-separated slugs)* | No |
| **Variable** | `SCRAPER_RELEASE_TYPE_FILTER` | `SCRAPER_RELEASE_TYPE_FILTER` | *(Optional release tags)* | No |
| **Variable** | `SCRAPER_DEBUG` | `SCRAPER_DEBUG` | `false` | No |

4. Click **Apply** and launch **WebUI** from the Unraid Docker tab.

---

## 4. Permissions Tip for Unraid Array Shares

If Unraid cannot write into `/mnt/user/roms` or `/mnt/user/appdata/rgt-sync` inside the container, verify directory ownership against the container's non-root `rgt` user (`docker exec retrogametalk-sync id`), or run Unraid's **Tools → New Permissions** on the target ROM share after adjusting directory ownership.

---

## 5. Community Applications (CA) Submission Checklist

<!-- TODO: Complete this checklist before submitting to ca.unraid.net -->

- [ ] Ensure GitHub repository is **public** with an OSI-approved `LICENSE` file at root
- [ ] Host a verified square PNG app icon (256x256 or 512x512) if required by `ca.unraid.net` scanner and update `<Icon>` in [`deploy/unraid/retrogametalk-sync.xml`](../../deploy/unraid/retrogametalk-sync.xml)
- [ ] Open a dedicated `[Support] RetroGameTalk Sync` thread on the Unraid Forums and set `<Support>` and `<Project>` URLs in the XML template and [`deploy/unraid/ca_profile.xml`](../../deploy/unraid/ca_profile.xml)
- [ ] Pass `xmllint --noout` validation and test template locally inside Unraid first
- [ ] Submit the repository through **`ca.unraid.net`** Validate & Scan portal
