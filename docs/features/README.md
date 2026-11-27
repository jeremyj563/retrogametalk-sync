# `rgt-sync` Feature Guide: Retro Game CMS, Preservation Mirror & Handheld Fleet Manager

Welcome to **`rgt-sync`** (RetroGameTalk Sync)—a self-hosted **retro game content management system (CMS)**, automated archival mirror, and multi-handheld deployment console built for retro-gaming enthusiasts, ROM hack & fan-translation collectors, CRT/FPGA hobbyists, and digital archivists.

---

## Why `rgt-sync` Exists

Managing a serious retro library across a home server and multiple handhelds, SD cards, or flashcarts usually means juggling a dozen tedious manual jobs:

- Checking repository pages by hand to see if a fan translation or ROM hack received a `v1.x` bugfix update
- Unpacking `.zip`, `.7z`, and `.rar` archives one by one, deleting `.nfo`/`.txt` clutter, and renaming files to clean **No-Intro + T-En** FAT32-safe filenames
- Remembering folder layouts across different handheld firmwares (`Roms/FC` on OnionOS vs. `Emulation/roms/nes` on EmuDeck vs. `games/NES` on MiSTer vs. `Assets/*/common` on Analogue Pocket)
- Tracking which games—and which patch versions—are installed on your Miyoo Mini vs. your Steam Deck vs. your EverDrive, and cleaning up older versions when updates arrive

**`rgt-sync` unifies preservation, curation, and hardware deployment into one self-hosted control console** while treating community servers with polite, adaptive rate limiting.

---

## At a Glance: The Five Workspaces

`rgt-sync` organizes everything into a responsive retro CRT control console with five dedicated workspaces:

| Workspace | What You Can Do Here |
| :--- | :--- |
| **1. Sync** | Launch **Incremental**, **Full**, or **Dry Run** syncs; watch the active game's **Hero Showcase** cover art, **Speed-Reactive Sync Wave**, and multi-worker transfer telemetry; monitor automatic download queue recovery; inspect **Sync Rule Readiness**, run history, D3 analytics, and filterable live logs; and retry failed downloads with one click. |
| **2. Catalog** | Visually browse, search, and curate your entire library in **Box-Art Grid**, **Detailed List**, or **Local Disk Tree** modes; manage **Favorites**, **Custom Collections / Handheld Loadouts**, and per-game **Pin / Ignore** rules; filter offline across any saved storage device (`Installed`, `Not Installed`, `Updates`); inspect inside `.zip`/`.7z`/`.rar`/`.tar` archives; and queue downloads or install/upgrade/uninstall games directly on mounted hardware. |
| **3. Sync Rules** | Choose **Target Consoles** (across 38+ live RetroGameTalk platforms), **Allowed Release Types**, **Incremental Cutoff**, and **Cron Scheduling**—all with **live mid-run hot-reloading** so rule edits take effect immediately on active syncs and catalog indexers, plus fast delta **Update Target Consoles** controls. |
| **4. Device Export** | Preview real end-to-end destination paths for your currently mounted handheld/SD card; run **Automatic Per-Mount Folder Auto-Configure** (with manual per-console overrides and ROM-type subfolder routing); customize **No-Intro + T-En** ROM filename formatting with a live **10-type preview matrix** (using built-in or real catalog games); and save optional per-device overrides. |
| **5. System Settings** | Configure encrypted RetroGameTalk credentials and mirror endpoints; tune live-reloadable **Request Pacing & Rate Protection** (AIMD spacing, parallel workers, HTTP `Range` chunking); export or restore **Secret-Free JSON Configuration Backups**; inspect SQLite schema migrations (`v1`–`v30`); and toggle diagnostic debug logging. |

### Always-Available Console Chrome

- **Sidebar Storage Device Drive Bay & Devices Fleet Drawer:** Mount, auto-configure, switch, reconnect (via IndexedDB), or eject SD cards and USB drives from any page, or open the **Devices Fleet Drawer** to manage 10+ handheld profiles with custom icons, colors, pinning, archiving, and `.rgt-device.json` card ID stamping.
- **Sidebar Service Telemetry, Mirrored Systems & CRT Display Studio:** Track live connection status, next scheduled sync countdown, per-console disk footprint (with rich hover telemetry cards), and customize **7 Phosphor Palettes**, **4 Monitor Presets**, and **5 Living UI Motion** levels.
- **Header Stereo Sound Deck & Trophy Case:** Enjoy a built-in **7-track Web Audio VGM Synthesizer** with live palette-matched spectrum visualizer and unlock bonus themes, chimes, and soundtracks as you build and deploy your collection.

---

## Explore the Feature Guides

1. **[Offline Library Catalog, Collections, Curation & Archive Explorer](./catalog-and-collection-curation.md)**
   Explore your library offline with **Favorites**, **Custom Collections / Handheld Loadouts**, per-game **Sync Rule Overrides (`Pin` / `Ignore`)**, multi-device offline filtering, **Installed ROM Update Detection**, in-place `.zip`/`.7z`/`.rar`/`.tar` archive exploration, and the **Local Disk Tree** file explorer.
2. **[Multi-Handheld Fleet Manager, Auto-Configure & Direct SD Installer](./handheld-and-sd-card-installer.md)**
   Manage 10+ handhelds and SD cards with `.rgt-device.json` hardware IDs, automatic per-mount folder **Auto-Configure**, **No-Intro + T-En** hybrid ROM naming, **Smart ROM Picker** + collision disambiguation, live install queueing, in-place upgrades, direct device uninstall, and the **CRT Display Studio**.
3. **[Automated Preservation Mirroring, Live Reload & Auto-Recovery](./mirroring-and-preservation.md)**
   Understand authoritative WordPress REST platform discovery (38+ live consoles), **Index-First** fast delta syncing, universal **live mid-run hot-reloading**, automatic **download queue recovery with crash-loop backoff**, self-hosted app lock (`APP_AUTH_PASSWORD`), and secret-free configuration backups.

---

> [!TIP]
> **Back of the Cartridge Manual:** Just like classic 8-bit hardware manuals, multi-cart bootlegs, and old-school search engines, `rgt-sync` hides a few retro-gaming secrets beneath its CRT bezel—and rumor has it more than one ROM bank is wired inside. Curious operators might try channeling a famous 1980s cheat code, tapping the console's cartridge emblem in rapid succession, or experimenting with classic arcade phrases, browser stunts, and vintage cartridge maintenance inside the Catalog search bar.
