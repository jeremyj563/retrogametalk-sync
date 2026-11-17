---
title: Catalog Install Filter Refinement & Operations Storage Folder Mappings
status: implemented
created_at: 2026-11-17T03:41:37Z
implemented_at: 2026-11-17T03:55:17Z
---

# Catalog Install Filter Refinement & Operations Storage Folder Mappings

Replace the ambiguous Catalog installation filter bar with clean toggleable `Installed` and `Not Installed` filter buttons, retire hardware-specific device presets in favor of a universal console folder mapping configuration on the Operations page, and introduce opt-in ROM Type subfolder routing with global defaults and per-console overrides.

## User Review & Critical Decisions

> [!IMPORTANT]
> All core UX and configuration choices below reflect your confirmed preferences and preserve existing custom folder overrides seamlessly during database upgrade.

- **Confirmed Decision 1 — Toggleable Catalog Install Filter**: Remove the confusing `All Devices` segment and replace the control with two independent, mutually exclusive toggle buttons: `Installed (N)` and `Not Installed (N)`. When neither is toggled on, the Catalog displays all games; clicking an active button deselects it back to showing all games.
- **Confirmed Decision 2 — Retire Hardware Device Presets**: Remove the preset selector (`EverDrive`, `MiSTer`, `OnionOS`, `Analogue`, `ODE`, `Custom`) across both Operations and the Storage Device Installer, replacing it with a single sensible default console folder table that works out of the box for common storage layouts and persists user edits in SQLite.
- **Confirmed Decision 3 — Opt-In ROM Type Subfolders (Global Defaults + Per-Console Overrides)**: All ROM types route into each console's single base folder by default (for example, `/SNES/`). Users can opt into ROM Type subfolders globally or per console, using sensible global category defaults (`Translations`, `Hacks`, `Homebrew`, `Ports`, `Undubs`, `Prototypes`, `Unlicensed`, `BIOS`, `DLC`, `PSX2PSP`) with optional per-console path overrides.
- **Confirmed Decision 4 — Retail in Console Root & Grouped Translations**: When ROM Type subfolders are enabled, `Retail ROM` files remain directly in the base console folder (for example, `/SNES/`) unless explicitly given a subfolder name, and all translation releases group into a single `Translations` subfolder by default.
- **Confirmed Decision 5 — Read-Only Installer Paths with Deep-Link to Operations**: The Storage Device Installer modal displays resolved destination paths (including ROM Type subfolders) as read-only metadata and provides an `Edit Folder Mappings` action that navigates straight to the Operations mapping section with the CRT phosphor spotlight highlight.

---

## 1. Overview & Core Concept

- **What It Does**:
  1. Gives Catalog users a self-explanatory two-button toggle (`Installed` / `Not Installed`) to isolate or exclude games already copied to their storage device without implying multi-device hardware profiles.
  2. Moves storage folder configuration out of the transient install modal and onto the **Operations** page as a first-class, database-persisted setup experience.
  3. Lets users customize base folder names per console and optionally route different ROM categories (Hacks, Translations, Homebrew, Ports, Undubs, Prototypes, etc.) into dedicated subfolders globally or on individual consoles.
- **Target Audience / Persona**: Retro enthusiasts curating multi-console flash carts, handhelds, ODEs, and external HDD/SSD ROM libraries who want a configure-once folder hierarchy that automatically organizes Retail releases, ROM Hacks, and Translations during both 2-click Express Installs and interactive Review Queue transfers.
- **Key Value**: Eliminates repetitive folder setup inside the export modal, removes decision fatigue over dozens of divergent handheld/FPGA presets, and keeps ROM types cleanly separated on storage media whenever desired.

---

## 2. User Experience & Visual Design

### Key User Flows

1. **Filtering Installed vs. Uninstalled Games in Catalog**:
   - In the Catalog filter bar alongside `Systems`, `Types`, and `Status`, users see two compact toggle buttons: `Installed (count)` and `Not Installed (count)`.
   - By default, neither button is pressed (`aria-pressed="false"`), naturally showing the entire catalog.
   - Clicking `Not Installed` highlights it in amber and filters to games not yet on the storage device; clicking `Not Installed` again toggles it off and restores the full catalog (or clicking `Installed` switches directly to installed games in phosphor green). The removable `Active:` filter strip also reflects and clears any active install filter.

2. **Configuring Console & ROM Type Folder Mappings in Operations**:
   - Navigating to **Operations** (or clicking `Edit Folder Mappings` inside the Storage Device Installer) scrolls smoothly to the new **Storage Device Folder Mappings** panel and triggers the phosphor section spotlight.
   - **ROM Type Subfolder Mode**: At the top of the section, a clean two-way mode switch lets the user choose between `Single Console Folder` (default — every ROM type lands in `/<Console>/`) and `Categorize by ROM Type Subfolders`.
   - **Global ROM Type Defaults**: Expanding or enabling ROM Type Subfolders reveals the curated category table (`Retail ROM` -> console root, `Translations` -> `Translations`, `ROM Hacks` -> `Hacks`, `Homebrew & Indie` -> `Homebrew`, `Ports` -> `Ports`, `Undub` -> `Undubs`, `Demos & Prototypes` -> `Prototypes`, `Bootleg & Unlicensed` -> `Unlicensed`, `BIOS & System` -> `BIOS`, `DLC & Updates` -> `DLC`, `PSX2PSP & Eboot` -> `PSX2PSP`) with a live path preview (for example, `/SNES/` for Retail vs. `/SNES/Hacks/` for Hacks).
   - **Per-Console Mapping Editor**: Below the global controls, consoles are organized by manufacturer (`Nintendo`, `Sony PlayStation`, `Sega`, `NEC & SNK`, `Other Consoles & Handhelds`, `Arcade & Home Computers`, `System BIOS & Other`) with instant search and a scope filter (`Synced & Discovered`, `All Consoles`, `Customized Only`).
   - Each console row shows its human-readable name, repository slug, editable base folder input (showing the universal default as placeholder), and a `Type Subfolders` disclosure toggle. Expanding a console's `Type Subfolders` drawer lets the user set that console's subfolder policy (`Follow Global`, `Enable Subfolders`, or `Single Folder`) and override individual ROM Type subfolder paths just for that system.
   - Any edit marks Operations as having unsaved changes, activating the sticky bottom **Save / Discard** bar and unsaved-navigation guard.

3. **Installing Games via Express Install or Review Queue**:
   - During **Express Install** and **Review Queue** transfers, every selected playable file resolves its destination directory from `(console slug, detected ROM type)` against the saved Operations mapping config—automatically creating console and ROM Type subdirectories on the mounted storage device, scanning those exact folders for existing/upgradeable versions, and streaming files directly into place.
   - Opening the **Install Prepared ROMs to Storage Device** modal displays the mounted device control, active folder-routing summary, and an `Edit Folder Mappings` link button. Each queued game and playable variant displays its exact read-only target path (such as `/SNES/Translations/` or `/GBA/Hacks/`).

### Visual Identity & Theme

- **Aesthetic Direction**: High-density retro-futuristic CRT operator console matching the existing workspace—clean architectural hairlines, restrained phosphor accents, and zero visual clutter.
- **Color Palette & Mood**: Uses existing semantic CRT theme variables (`bg-crt-bg`, `bg-crt-surface`, `bg-crt-elevated`, `border-crt-border`, `text-crt-text`, `text-crt-muted`) with `text-crt-phosphor` reserved for active selections, resolved destination paths, and primary actions, and `text-crt-amber` for unsaved-change indicators and `Not Installed` filtering.
- **Typography & Hierarchy**: Display headings in `font-display`, UI labels in crisp sans, and all folder paths, slugs, byte metrics, and facet counts in `font-mono tabular-nums` to prevent layout jitter.
- **Component Styling & Layout**:
  - Single-elevation flat surfaces with `1px` borders (`border-crt-border`), avoiding nested card-in-card boxes or thick left accent stripes.
  - All interactive buttons and toggles enforce single-line geometry (`whitespace-nowrap shrink-0`).
  - Static metadata (slugs, target path readouts, customization counts) renders as quiet inline text separated by `·` rather than static pill badges.
- **Interactive Feedback & Motion**:
  - Compositor-friendly transitions under `200ms` on toggles and disclosure drawers.
  - Deep-linking from the Install modal to Operations reuses the signature `.crt-section-spotlight` phosphor sweep while respecting `prefers-reduced-motion`.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Unified Universal Console Defaults Instead of Hardware Presets**
  - *Chosen Approach*: Ship a comprehensive default console folder dictionary (`NES`, `SNES`, `N64`, `GB`, `GBC`, `GBA`, `GENESIS`, `SEGACD`, `32X`, `SMS`, `GG`, `SATURN`, `DREAMCAST`, `PSX`, `PS2`, `PSP`, `PCE`, `PCECD`, `NEOGEO`, `ARCADE`, etc.) paired with persistent per-console overrides in SQLite.
  - *Why*: Handheld firmwares, flash carts, FPGA cores, and desktop emulators number in the hundreds; a clean, recognizable default directory naming scheme with one-time editable overrides is simpler to understand and works across any storage drive.
  - *Upgrade Continuity*: Append-only SQLite migration `v14` carries forward any custom folder entries previously saved by the user so existing setups remain intact.

- **Decision 2: Hierarchical ROM Type Path Resolution (`Console Base` + `Optional Type Subfolder`)**
  - *Chosen Approach*: Resolve destination paths in two clean layers: first resolve the console's base folder (custom console override -> universal default), then—if ROM Type subfolders are active globally or enabled on that console—append the resolved ROM Type subfolder (per-console type override -> global type default). Empty subfolder strings (`""`, the default for `Retail ROM`) resolve directly to the console's base folder.
  - *Why*: Supports every common curation style—flat console folders, global subfolders across all systems, or hybrid setups (for example, keeping most systems flat while splitting SNES and GBA into `Hacks/` and `Translations/`)—without duplicating configuration across 60+ consoles.

- **Decision 3: Deterministic Per-Target ROM Type Classification**
  - *Chosen Approach*: Determine each playable file's ROM Type category using file-level role metadata first (`Hack`, `English Translation`, `Undub`, `Original ROM`, etc.) and release-level tags second, collapsing any translation language tag (`translation:english`, `translation:spanish`, `machine_translation`, etc.) into the unified `translations` bucket.
  - *Why*: A single catalog entry can bundle an unmodified Original ROM alongside a ROM Hack or Translation file; file-aware classification ensures each extracted binary lands in the subfolder matching what that file actually is.

---

## 4. Technical Architecture & Data Strategy

### Architecture & Component Diagram

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                         SQLite Persistence (Schema v14)                      │
│   scraper_config.storage_folder_config_json (migrates legacy custom map)     │
└──────────────────────────────────────┬───────────────────────────────────────┘
                                       │ GET /api/config · PUT /api/config
                                       ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                  Shared Storage Folder Resolution Engine                     │
│  • Universal Console Folder Defaults (all cataloged & fallback slugs)        │
│  • ROM Type Classifier (file role + release tags → canonical type bucket)    │
│  • Path Resolver: Console Base Folder + Optional Global/Console Type Path    │
└───────────┬──────────────────────────────────────────────────────┬───────────┘
            │                                                      │
            ▼                                                      ▼
┌─────────────────────────────────────────┐    ┌───────────────────────────────┐
│        Operations Workspace             │    │  Bulk Storage Installer Flow  │
│  • Storage Device Folder Mappings Panel │    │  • Express & Review Runners   │
│  • Global Type Subfolder Mode & Paths   │◄───│  • Per-Target Folder Scan &   │
│  • Brand-Grouped Console Path Editor    │Deep│    Upgrade Detection          │
│    + Per-Console Type Override Drawer   │Link│  • Read-Only Path Readouts +  │
│  • Dirty State + Sticky Save/Discard    │    │    "Edit Folder Mappings" CTA │
└─────────────────────────────────────────┘    └───────────────┬───────────────┘
                                                               │
                                                               ▼
                                               ┌───────────────────────────────┐
                                               │       Catalog Workspace       │
                                               │  • Toggleable "Installed" &   │
                                               │    "Not Installed" Buttons    │
                                               │  • Active Filter Summary Sync │
                                               └───────────────────────────────┘
```

### Data Model & State

- **Persisted Storage Folder Mapping Config (`StorageFolderMappingConfig`)**:
  - `typeSubfoldersEnabled: boolean` — Global opt-in switch (`false` by default so all ROM types route to the single console folder initially).
  - `globalTypeSubfolders: Record<StorageRomCategoryKey, string>` — Editable relative subfolder names for each canonical ROM category (`retail: ""`, `translations: "Translations"`, `hack: "Hacks"`, `homebrew: "Homebrew"`, `port: "Ports"`, `undub: "Undubs"`, `demo_proto: "Prototypes"`, `bootleg: "Unlicensed"`, `bios: "BIOS"`, `dlc: "DLC"`, `psx2psp: "PSX2PSP"`).
  - `systemFolders: Record<string, string>` — Sparse map of user-customized base console folder paths keyed by normalized system slug (empty/omitted keys automatically fall back to the universal console default).
  - `systemTypeOverrides: Record<string, { mode?: 'inherit' | 'enabled' | 'disabled'; subfolders?: Partial<Record<StorageRomCategoryKey, string>> }>` — Sparse per-console overrides for enabling/disabling ROM Type subfolders or customizing specific category subfolder paths on an individual system.
- **Database Migration (`v14`)**:
  - Appends migration `v14` to add `storage_folder_config_json` on `scraper_config` and migrate any existing custom entries from `device_folder_map_json` (plus materialize non-EverDrive preset paths only if the user had explicitly saved a non-default preset) so existing installations preserve their exact paths without manual re-entry.

### Interactive Component & State Mapping

- **Catalog Installation Toggle Group**:
  - Clicking `Installed` toggles `installedFilter` between `'only'` and `'all'` and resets pagination to page 1.
  - Clicking `Not Installed` toggles `installedFilter` between `'exclude'` and `'all'` and resets pagination to page 1.
  - Both buttons expose `aria-pressed` state and stay synchronized with the removable `Active:` filter token list and `Clear All` action.
- **Operations Storage Folder Mappings Section**:
  - Supports deep-link navigation target `'storageMappings'` (`#operations/storage-mappings`), scrolling into view with sticky-header offset and firing the 2.5-second `.crt-section-spotlight` animation.
  - Normalizes relative folder inputs (trimming leading/trailing slashes, stripping unsafe path traversal segments like `..`, and optionally applying FAT32-safe path segment sanitization during writes).
  - Computes canonical JSON equality against `config.storageFolderConfig` to drive `dirtyState.changedSections` (`'Storage Folder Mappings'`), enabling the sticky **Save / Discard** bar and unsaved-changes route guard.
- **Installer Engine & Modal Integration**:
  - Each `ExportQueueRow` carries its release tags and file role so `resolveTargetStorageFolder` computes the exact destination directory per playable target (for example, routing an item's `Original ROM` target to `/SNES/` and its `English Translation` target to `/SNES/Translations/` when subfolders are enabled).
  - Mounted storage device scans, older-version upgrade detection, and directory creation operate per resolved `(console + ROM type)` folder path, ensuring exact-match skipping and version upgrades remain accurate inside categorized subfolders.
  - Clicking `Edit Folder Mappings` in the modal closes the modal (leaving any active background transfer running undisturbed in the top dock) and navigates to `#operations/storage-mappings`.
