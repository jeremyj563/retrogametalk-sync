# `rgt-sync` Feature Guide for Retro-Gaming Enthusiasts & Preservationists

Welcome to **`rgt-sync`** (RetroGameTalk Sync)—a self-hosted preservation mirror, offline game library browser, and direct handheld/SD card installer built for retro-gaming enthusiasts, ROM hack & fan-translation collectors, CRT/FPGA hobbyists, and digital archivists.

---

## Why `rgt-sync` Exists

Curating a personal retro library—especially if you follow fan translations, quality-of-life ROM hacks, homebrew releases, undubs, and multi-region classics—usually involves tedious manual work:

- Checking repository pages by hand to see if a translation or ROM hack got a `v1.2` bugfix update
- Downloading `.zip`, `.7z`, and `.rar` archives one by one, unpacking them, deleting `.nfo`/`.txt`/readme clutter, and renaming files so they sort cleanly on FAT32 SD cards
- Trying to remember console folder names across handheld firmwares (`snes` vs. `SFC`, `psx` vs. `PS`, `gba` vs. `GBA`) or keeping track of which games you've already copied onto your handheld SD card or EverDrive

**`rgt-sync` automates that entire workflow from end to end** while treating community infrastructure with polite, adaptive rate-limiting.

---

## At a Glance: The Four Workspaces

`rgt-sync` organizes everything into a responsive retro CRT control console with four dedicated workspaces:

| Workspace | What You Can Do Here |
| :--- | :--- |
| **1. Sync** | Run **Incremental**, **Full**, or **Dry Run** syncs on demand; monitor live download speed, active file progress, adaptive rate-limit pacing, and real-time activity logs; inspect run history; and retry failed downloads with a single click. |
| **2. Catalog** | Visually browse, search, and filter your entire offline collection with local box art and full-resolution screenshots; inspect inside `.zip`/`.7z`/`.rar` archives; download clean Prepared ROMs; or batch-install games directly onto a plugged-in SD card or USB drive. |
| **3. Schedule** | Set up unattended background syncs (e.g., every 6 hours, nightly, or weekly) so newly published translations, hacks, and releases appear in your local archive automatically. |
| **4. Operations** | Configure your RetroGameTalk credentials, choose which consoles and ROM types to mirror, customize SD card **Storage Folder Mappings** (including optional ROM-Type subfolders), set ROM naming preferences, tune polite download pacing, and browse your on-disk repository files. |

Plus, from the left sidebar on any page, you can monitor your **live connection & auth status**, **next scheduled sync countdown**, **total & per-system disk usage** (with a detailed per-console stats popover on hover), and customize the **CRT Display Studio** monitor look and feel.

---

## Explore the Feature Guides

1. **[Automated Mirroring, Polite Archival & Scheduling](./mirroring-and-preservation.md)**
   How `rgt-sync` authenticates once, discovers new and updated releases across 30+ classic platforms, filters by console and release type (Retail, Hacks, Translations, Homebrew, Ports, Prototypes), mirrors original-resolution box art and screenshots offline, and runs safely on an unattended schedule.
2. **[Offline Library Catalog, Rich Metadata & Archive Inspection](./catalog-and-collection-curation.md)**
   How to explore your preserved collection offline with multi-faceted `ANY`/`ALL` filters, full-resolution screenshot lightboxes, multi-file release rollups, inside-the-archive inspection, clutter detection, and **Installed / Not Installed** device tracking.
3. **[Direct Handheld / SD Card Installer, Smart ROM Picker & Folder Mappings](./handheld-and-sd-card-installer.md)**
   How to write ready-to-play, cleanly named ROMs straight from your browser onto SD cards, USB drives, flashcarts, and retro handhelds—complete with **Smart ROM Picker** version selection, automatic in-place SD card version upgrades, customizable console/type folders, and the **CRT Display Studio**.

---

> [!TIP]
> **Back of the Cartridge Manual:** Just like classic 8-bit hardware manuals, multi-cart bootlegs, and old-school search engines, `rgt-sync` hides a few retro-gaming secrets beneath its CRT bezel—and rumor has it more than one ROM bank is wired inside. Curious operators might try channeling a famous 1980s cheat code, tapping the console's cartridge emblem in rapid succession, or experimenting with classic arcade phrases, browser stunts, and vintage cartridge maintenance inside the Catalog search bar.


