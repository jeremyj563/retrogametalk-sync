# Automated Mirroring, Polite Archival & Scheduling

For preservationists and home-lab collectors, `rgt-sync` acts as a "set-and-forget" archival daemon that keeps your local NAS, home server, or desktop hard drive synchronized with RetroGameTalk's repository—without hammering community servers or leaving half-downloaded files behind.

---

## 1. Encrypted One-Time Account Setup & Persistent Sessions

- **Encrypted Local Credentials**: Enter your RetroGameTalk username and password once in **Operations** (or pass them via environment variables in Docker/Kubernetes). Your password is encrypted at rest using AES-256-GCM and is never exposed back to the browser.
- **One-Click Connection Test**: Use **Test Auth & Discover** to verify your login, inspect response latency, and automatically discover available console sections before running your first sync.
- **Persistent Login Cookies**: Once authenticated, `rgt-sync` saves your session cookies locally so scheduled runs and restarts pick right back up without repeatedly logging in.

---

## 2. Three Sync Modes for Every Workflow

From the top header bar, you can launch a sync at any time in the mode that fits what you're doing:

- **Incremental Sync (Recommended Default)**: Uses a high-watermark timestamp to check only newly published or recently updated releases since your last completed sync. Ideal for daily or 6-hourly upkeep—finishing quickly while catching brand-new fan translations and hack updates.
- **Full Sync**: Sweeps the entire catalog across all of your selected consoles to verify completeness and backfill any missing releases or newly added platforms. Includes a confirmation prompt so you never trigger a full multi-console sweep by mistake.
- **Dry Run Toggle (Preview Without Downloading)**: Flip on **Dry Run** before starting either an Incremental or Full sync to simulate discovery, filtering, and cataloging without downloading any ROM archives to disk—perfect for testing new console or release-type filters first.

---

## 3. Selective Console & Release-Type Curation

Not everyone has 20 TB of NAS space—maybe you only collect 8-bit/16-bit cartridge consoles, Sony handhelds, or English fan translations! In **Operations**, you can tailor exactly what gets mirrored:

- **80+ Supported Consoles, Handhelds & Computers**: Pick individual platforms grouped by manufacturer (Nintendo, Sega, Sony, NEC, Atari, SNK, Bandai, Commodore, Sinclair, MSX, Arcade, Homebrew Fantasy Consoles, and more)—or leave the filter open to mirror everything.
- **Granular Release-Type Filtering**: Choose which categories of releases you want `rgt-sync` to download:
  - **Retail ROMs** (original commercial releases across regions)
  - **Translations** (English & international fan translations)
  - **ROM Hacks** (improvement patches, total conversions, randomizers, difficulty & QoL hacks)
  - **Homebrew** (indie and modern community-made games for classic hardware)
  - **Ports & Conversions** (cross-platform ports, decompilations, PSX2PSP EBOOTs)
  - **Undubs & Audio Restorations**
  - **Prototypes, Betas & Demos**

---

## 4. Complete Preservation: Multi-File Releases, Metadata & Artwork

Preserving a release means more than saving a mystery `.zip` file:

- **Structured On-Disk Layout**: Archives are organized cleanly on your storage drive by `<system>/<release-folder>/<archive-file>`, preserving original upstream archives intact for archival fidelity while keeping multi-part or multi-version releases grouped together under a single catalog entry.
- **Offline Box Art & High-Resolution Screenshots**: Alongside ROM archives, `rgt-sync` automatically mirrors cover art and unwraps full-resolution gameplay screenshots locally—so even if you browse your server completely offline years from now, every game card and detail drawer remains rich and visual.
- **Rich Historical Metadata**: Captures title, console, publisher, developer, release year, genres, regions, languages, patch/translation credits, and full release descriptions.
- **Crash-Safe `.part` Downloads**: Every file downloads to a temporary `.part` staging file first and is only renamed into place once the complete payload finishes. If your power blinks or you click **Stop** mid-download, `rgt-sync` automatically cleans up partial files so corrupt ROMs never pollute your archive.

---

## 5. Polite Adaptive Pacing & Live Telemetry

Community retro repositories rely on shared bandwidth. `rgt-sync` has a built-in **Adaptive Rate Limiter** that acts as a respectful guest automatically:

- **Gentle Jittered Spacing**: Spaces out requests with slight natural randomness instead of robotic bursts, gently speeding up within your configured bounds when the server is responsive and backing off automatically (honoring `Retry-After` cooldowns) if the server ever gets busy.
- **Smooth Live Transfer Status & Telemetry Deck**: On the **Sync** page, watch active transfers in a layout-stable progress bar (engineered so rapid back-to-back kilobyte-sized 8-bit ROM downloads never make the page jump or flicker), alongside live throughput charts, request latency, rate-limit delay curves, and filterable activity logs.
- **Unattended Cron Scheduling & Easy Retries**:
  - Enable automatic background syncs on the **Schedule** page using one-click presets (every 6 hours, every 12 hours, daily at midnight, weekly) or any custom 5-field cron expression.
  - If a file ever fails due to a brief internet hiccup, open the **Failed Queue Drawer** to retry a single file, retry one specific console, or retry all failed items at once.
