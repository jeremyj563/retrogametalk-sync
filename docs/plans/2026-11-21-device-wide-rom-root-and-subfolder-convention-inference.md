---
title: Device-Wide ROM Root & Subfolder Convention Inference
status: implemented
created_at: 2026-11-21T13:11:20Z
implemented_at: 2026-11-21T13:16:00Z
---

# Device-Wide ROM Root & Subfolder Convention Inference

Automatically inherit each mounted storage device's detected ROM root (e.g., `/Roms/`, `/games/`, `/Emulation/roms/`) and ROM-type subfolder naming/casing conventions (e.g., `/hacks`, `/trans`, lowercase unseen types like `/homebrew`) across all consoles on that device—including brand-new console folders created automatically on install—while previewing those inferred paths right inside the Live Export Destination Preview.

## User Review & Critical Decisions

> [!IMPORTANT]
> All core behavioral decisions below were confirmed during clarification.

- **Cross-Console Subfolder Propagation (Confirmed)**: Whenever Auto-Configure detects ROM-type subfolders on any console on the mounted device (such as `SNES/hacks` or `NES/trans`), that convention applies automatically across **all consoles on that mounted device** (both existing flat consoles and newly created console folders).
- **Unseen ROM Categories (Confirmed)**: When installing a ROM type that does not exist anywhere on the card yet (such as Homebrew on a card that only has `hacks` and `trans`), the folder name automatically **matches the card's detected casing style** (e.g., `homebrew` for lowercase cards, `HOMEBREW` for uppercase cards, `Homebrew` for title-case cards).
- **Preview Visibility (Confirmed)**: Device Export surfaces the **inferred ROM root and subfolder convention directly inside the Live Export Destination Preview card**, alongside an explicit preview row showing what happens when installing a console not yet present on the card.
- **Manual Override Precedence (Recommended Default)**: Saved manual overrides remain strictly separate and always take top priority over both auto-detected and device-inferred paths; unchecking the session subfolder toggle cleanly disables device-inferred subfolders for the active mount.

---

## 1. Overview & Core Concept

- **What It Does**: Extends automatic per-mount Auto-Configure from per-console folder matching into full **device-wide convention learning**. When you mount any handheld SD card, MiSTer FPGA drive, flash cart, or EmuDeck volume, the app learns three session-scoped traits from the folders already on disk:
  1. **Base ROM Root**: Where consoles live (e.g., `Roms/`, `games/`, `Emulation/roms/`, or drive root) plus their dominant leaf casing (e.g., `Emulation/roms/n64` vs `Roms/N64`).
  2. **Subfolder Naming Map**: Exact folder names already in use for ROM categories across the card (e.g., `hacks` for ROM Hacks, `trans` for Translations, including shorthand aliases like `trans`, `hb`, `protos`, `mods`).
  3. **Subfolder Casing Style**: Whether the card uses lowercase (`hacks`, `trans`), UPPERCASE (`HACKS`, `TRANS`), or Title Case (`Hacks`, `Translations`), applied automatically to unseen ROM categories like `homebrew` or `ports`.
- **Target Audience**: Retro gamers swapping between multiple SD cards, handheld OS layouts, MiSTer drives, and flash carts who want newly added consoles and ROM categories to blend seamlessly into each device's existing directory structure without manual setup.
- **Key Value**: Eliminates stray folders created at the wrong directory level (like `/N64` next to `/Roms/`) and prevents inconsistent mixed-casing subfolders (like `/Hacks` beside `/trans`), keeping every mounted device tidy on the very first write.

---

## 2. User Experience & Visual Design

### Key User Flows

1. **Mount Any Storage Device (OnionOS, EmuDeck, MiSTer, Custom SD)**
   - User mounts a storage device (from the left sidebar drive bay or Device Export).
   - Auto-Configure scans the tree automatically and computes both exact per-console matches and the **device-wide convention profile** (ROM root, observed subfolder aliases, and dominant casing).
2. **Immediate Clarity in the Live Export Destination Preview**
   - On **Device Export**, the top hero card immediately displays:
     - **Inferred Convention Strip**: A quiet, single-line unboxed monospace summary right above the destination rows whenever a ROM root or subfolder convention is inferred (e.g., `New consoles → /Roms/<SYSTEM>` · `Subfolders: Hacks → /hacks · Translations → /trans · Unseen → lowercase`).
     - **Destination Preview Rows**: Shows exact paths for the mounted device's detected console (`Retail ROM`, `ROM Hack`, `Translation`) **plus** an explicit **`New console`** preview row (picking a console not currently present on the card, demonstrating an unseen or inferred category such as `/Roms/N64/homebrew/…`) attributed as `· Inferred`.
3. **Optional Session Toggle & Manual Overrides**
   - Toggling **Apply detected subfolder convention across device** off inside the hero card immediately disables device-inferred subfolders for the active session, updating all preview rows (including the `New console` row) in real time without dirtying saved settings.
   - Any saved **Manual Console Override** (base folder path, custom subfolder names, or explicit `Single Folder` disable for a specific console) continues to win over device inference.
4. **Automatic Folder Creation on Install**
   - When installing via **Express Install** or the **Review Export Modal**, any console not yet on the card automatically resolves into `<detectedRomRoot>/<ConsoleFolder>/<InferredSubfolder>` and creates the nested path segments cleanly on write.
   - Swapping to another device (or ejecting) clears the session-inferred conventions immediately so one device's `games/` or `trans` style never leaks onto another card.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Runtime-Only Device Conventions vs. Persisting Into Saved Config**: Session-scoped `runtimeBaseRomRoot`, `runtimeConsoleCasing`, and device-inferred subfolder conventions live strictly in the composed runtime configuration and are never persisted to SQLite, preventing cross-device leakage.
- **Decision 2: Scope of Subfolder Casing & Alias Inference**: Expands shorthand aliases (`trans`, `transl`, `eng`, `t-en`, `tl`, `hb`, `unlic`, `mods`, `patched`), tallies majority names per observed category, detects dominant casing style (`lower`/`upper`/`title` while skipping acronym categories like `BIOS` when voting), and applies casing-matched names to unseen categories.
- **Decision 3: Protecting Non-ROM Special Categories & Unique Hardware Layouts**: Protects standalone `BIOS` / `OST` paths from being nested inside `Roms/`, and avoids fabricating synthetic Analogue Pocket `Assets/<core>/common` paths for uninstalled FPGA cores.

---

## 4. Technical Architecture & Data Strategy

```text
Mounted Device Scan -> Auto-Configure Discovery & Convention Inference
  -> 4-Tier Effective Folder Resolution:
     1. Saved Manual Overrides
     2. Exact Detected Console Folders & Per-Console Disk Subfolders
     3. Mounted Device Inferred Conventions (ROM Root + Console Casing + Subfolder Naming/Casing)
     4. Universal Defaults + Saved Global Organization
  -> Device Export Live Preview UI (Convention Strip + 4th "New console" Row)
  -> Bulk Express Install, Review Export Modal & Mirrored Systems Sidebar
```
