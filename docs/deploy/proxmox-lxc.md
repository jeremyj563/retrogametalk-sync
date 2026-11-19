# Deploying on Proxmox VE (LXC)

Proxmox VE does not ship a single built-in app store, so homelab operators generally run **RetroGameTalk Sync** using one of two clean LXC architectures:

1. **Path A — Proxmox VE 9.1+ Native OCI LXC:** Pulls `ghcr.io/jeremyj563/retrogametalk-sync` directly as a Proxmox OCI container template (lightweight, zero Docker-in-LXC daemon overhead).
2. **Path B — Unprivileged Docker-in-LXC (Proxmox VE 7 / 8 / 9):** Runs a minimal Debian/Alpine LXC with `nesting=1,keyctl=1` + Docker Compose (most widely compatible across all Proxmox versions).

In **both** paths, store mirrored ROMs and `.rgt-data` on a **persistent Proxmox bind-mount point (`mp0`)** on the host ZFS/LVM/directory pool so destroying or rebuilding the LXC never touches your game collection.

---

## 1. Prepare Persistent Host Storage on Proxmox

On the **Proxmox VE host shell**, create the persistent directory on your ZFS pool or storage disk (example: `/tank/rgt-sync`):

```bash
mkdir -p /tank/rgt-sync/.rgt-data
# Default UID/GID shift for unprivileged LXCs adds +100000 to guest IDs.
# Inspect container rgt UID/GID or relax permissions on dedicated host directory:
chmod -R 775 /tank/rgt-sync
```

> [!IMPORTANT]
> If mounting into an **unprivileged LXC** (`unprivileged=1`), guest UID `X` maps to host UID `100000 + X` unless you add custom `/etc/subuid` / `/etc/subgid` idmaps. Ensure `/tank/rgt-sync` is owned by the mapped host UID/GID (or mapped cleanly via Proxmox `lxc.idmap`).

---

## 2. Path A — Proxmox VE 9.1+ Native OCI LXC

Starting with **Proxmox VE 9.1**, you can pull OCI container images straight into template storage and launch them natively as LXCs.

### Step 1: Pull the OCI Image in Proxmox

In the Proxmox UI (**`<node> → local (pve) → CT Templates → Pull from OCI Registry`**) or via CLI on the host:

```bash
# Check available OCI pull options on Proxmox 9.1+
pveam pull local ghcr.io/jeremyj563/retrogametalk-sync:1.7.0
```

*(Note: Proxmox requires OCI registry credentials/anonymous token pulls; check your `pveam` / UI modal for `ghcr.io/jeremyj563/retrogametalk-sync:1.7.0`.)*

### Step 2: Create the Container & Attach Persistent `mp0`

1. Create an unprivileged CT from the pulled `retrogametalk-sync` OCI template:
   - **Memory:** `512 MiB`–`1024 MiB` (larger headroom recommended when streaming `.7z` archives)
   - **Cores:** `2`
   - **Network:** Static IP or DHCP on your homelab bridge (`vmbr0`)
2. Bind-mount the host storage directory into `/run/repo` in `/etc/pve/lxc/<CTID>.conf`:

```ini
mp0: /tank/rgt-sync,mp=/run/repo
```

3. Verify environment variables (`PORT=3000`, `DATA_DIR=/run/repo/.rgt-data`, `DOWNLOAD_DIR=/run/repo`) are preserved from the OCI image config, start the CT, and open **`http://<ct-ip>:3000`**.

---

## 3. Path B — Unprivileged Docker-in-LXC *(All Proxmox VE Versions)*

### Step 1: Create an Unprivileged Debian 12 LXC

Create a Debian 12 LXC (e.g., CTID `210`) with:
- **Unprivileged container:** Checked (`Yes`)
- **Features:** Enable **`Nesting`** (`nesting=1`) and **`keyctl`** (`keyctl=1`) under **Options → Features**
- **Root Disk:** `8 GiB` (OS + container layers only)
- **Memory / Swap:** `1024 MiB` RAM / `512 MiB` Swap
- **CPU:** `2` cores

### Step 2: Attach Persistent Storage via `mp0`

On the **Proxmox VE host**, bind `/tank/rgt-sync` into the LXC at `/mnt/rgt-repo`:

```bash
pct set 210 -mp0 /tank/rgt-sync,mp=/mnt/rgt-repo
pct start 210
```

### Step 3: Install Docker Engine & Launch `rgt-sync` Inside the LXC

Enter the LXC console (`pct enter 210`):

```bash
apt-get update && apt-get install -y ca-certificates curl
curl -fsSL https://get.docker.com | sh

mkdir -p /opt/rgt-sync && cd /opt/rgt-sync
curl -fsSLO https://raw.githubusercontent.com/jeremyj563/retrogametalk-sync/main/docker-compose.yml
curl -fsSL https://raw.githubusercontent.com/jeremyj563/retrogametalk-sync/main/.env.example -o .env
```

Point the Compose volume to the persistent Proxmox mount point `/mnt/rgt-repo`:

```yaml
    volumes:
      - /mnt/rgt-repo:/run/repo
```

Verify permissions inside the LXC and start:

```bash
# Confirm mapped UID inside the container and ensure /mnt/rgt-repo is writable
docker compose up -d
docker compose logs -f rgt-sync
```

Open **`http://<lxc-ip>:3000`** in your browser.

---

## 4. Upgrading & Rebuilding the LXC Safely

- Because `/run/repo` lives on `mp0` (`/tank/rgt-sync` on the host), you can upgrade in seconds (`docker compose pull && docker compose up -d`) or even destroy and recreate the entire LXC without losing downloaded ROMs, box art, or `scraper.db`.
- Take ZFS snapshots on `/tank/rgt-sync` before major changes—if you snapshot `.rgt-data` separately from ROM media, stop the container briefly or ensure SQLite checkpoints cleanly first.
