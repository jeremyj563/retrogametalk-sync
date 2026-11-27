# Multi-Handheld Fleet Manager, Auto-Configure & Direct SD Installer

Whether you play on an Anbernic, Miyoo Mini, Retroid, TrimUI, Steam Deck, Analogue Pocket, MiSTer FPGA, or original console flashcart (EverDrive / FXPAK Pro / Terraonion / Fenrir), `rgt-sync` treats your collection of devices as a first-class fleet—plug in any SD card or USB drive and deploy extracted, cleanly named, ready-to-play ROMs straight from your browser.

---

## 1. Hardware-Pinned Multi-Device Fleet Management

Managing 10+ handhelds, SD cards, and FPGA setups no longer means overwriting one global "Installed" flag or mixing up cards that all happen to be named `SDCARD` or `Roms`:

- **Auto-Stamped Card Identity (`.rgt-device.json`):** The first time you mount a storage device, `rgt-sync` stamps a tiny hidden `.rgt-device.json` UUID marker (`dev_<uuid>`) at the card root (protected from ROM scans and uninstalls, with non-blocking fallback for read-only media) paired with Chromium's `FileSystemHandle.isSameEntry()` verification—uniquely identifying every physical SD card even across machines or identical folder names.
- **Smart Identify / Link Device Modal:** Mounting an unrecognized card probes on-card volume labels and firmware signatures (`autorun.inf`, muOS `device.txt`, Batocera/KNULLI/Recalbox hostnames, OnionOS, GarlicOS, Analogue Pocket, MiSTer, EverDrive, MinUI, ES-DE/EmuDeck) to pre-fill a helpful name and matching hardware icon—letting you **Create New Device** or **Link Existing Profile** (e.g., when migrating to a larger SD card).
- **Persistent IndexedDB Reconnects:** Mounted directory handles are saved locally in IndexedDB. On reload, authorized cards reconnect automatically or show a 1-click **Reconnect `<Device>`** shortcut in the left sidebar **Storage Device** bay.
- **Devices Fleet Drawer:** Click **Devices** in the sidebar bay to open a searchable slide-over manager with **Active / Pinned / Archived** tabs, custom hardware icons (7 form factors) and CRT color badges (6 hues), **Stamp Card ID** repair, 1-click **Reconnect**, **Browse Installed** offline jump, **Pin / Archive**, and **Delete**.
- **Per-Device Install History & Optional Overrides:** Every device tracks its own independent installed games, file versions, and paths in SQLite—plus optional per-device console folder and ROM naming overrides in **Device Export**.

---

## 2. Automatic Per-Mount Folder Auto-Configure

Different handheld firmwares expect totally different folder trees (`Roms/FC` vs. `Emulation/roms/nes` vs. `games/NES` vs. `Assets/*/common`). `rgt-sync` handles this automatically every time you mount or switch a device:

- **3-Layer Precedence Model:** `Universal Defaults` → `Mounted Device Auto-Config` → `Saved Manual Overrides`. Swapping from a Miyoo Mini SD card to a MiSTer FPGA card or Steam Deck immediately adapts every destination path without touching your saved manual overrides.
- **75+ Retro Platforms & Firmware Signatures:** Automatically recognizes OnionOS / GarlicOS (including spelled-out folders like `TWENTYSIXHUNDRED`, `FIFTYTWOHUNDRED`, `THIRTYTWOX`, `SEGASGONE`), ES-DE / Batocera / EmuDeck, MiSTer FPGA, Analogue Pocket OpenFPGA, flashcarts, and decorated human-readable folder names using parent-root consensus and shallow ROM-extension corroboration.
- **Device-Wide ROM Root & Subfolder Convention Inference:** If your card keeps ROMs under `Roms/`, `games/`, or `Emulation/roms/`, installing a console not yet on the card automatically creates its folder inside that inferred root with matching casing (while protecting standalone `BIOS`/`OST` folders and Analogue Pocket `Assets/` paths). Detected shorthand ROM-type subfolders (`hacks`, `trans`, `hb`, `unlic`) and their casing style propagate cleanly across consoles too.
- **Live Export Destination Preview:** At the top of **Device Export**, inspect real end-to-end sample paths (`Retail`, `ROM Hack`, `Translation`, and `New console · Inferred`) for your active device with clear `Auto-detected` / `Manual override` / `Default` badges, plus a compact **Search-to-Add** manual console override combobox.

---

## 3. No-Intro + T-En Hybrid ROM Naming & Live Preview Matrix

In **Device Export → 02. ROM Filename Formatting**, configure clean, FAT32-safe filenames built around modern **No-Intro + T-En** conventions:

- **Type-Aware Hybrid Tagging (`{statusParen}` + `{modBracket}`):** Cleanly separates origin/development status in parentheses (`(Proto)`, `(Demo)`, `(Homebrew)`, `(Port)`, `(Unl)`, `(Rev A)`) from post-release fan modifications in square brackets (`[T-En v1.3]`, `[T-Es v2.0]`, `[T-En MTL v1.0]`, `[Hack v1.42]`, `[Undub v1.1]`), while staying compatible with legacy naming stems during SD card upgrades.
- **Always-Visible 10-Type Live Preview Matrix:** See how every ROM category renders in real time with syntax-tinted segments, tabular character counts, and explicit FAT32 sanitization/truncation badges. Switch between **Built-in Examples** and **Real Catalog Games** (with a **Shuffle** button) to test directly against titles in your own library.
- **Cursor-Aware Pattern Builder & Per-Type Overrides:** Insert tokens right at your cursor position, hover tokens to inspect live values, catch unknown tokens or unbalanced brackets inline, pick quick max-length presets (`Unlimited`, `64`, `128`, `255`), and optionally customize templates per ROM type.

---

## 4. Direct Browser-to-SD-Card Streaming & Live Install Queue

Using Chromium-based browsers (Chrome, Edge, Brave, Vivaldi, Arc, Opera) over `localhost` or HTTPS:

- **One-Click Install Anywhere + Live Queueing:** Click **Install**, **Update**, or **Reinstall** on any Catalog grid card, list row, Game Detail drawer, Collection banner, Updates strip, or Bulk Selection bar. Clicking additional games while a transfer is active appends them straight to the **Live Install Queue** (marked **Queued**) with automatic deduplication—no waiting for one game to finish before queueing the next.
- **Smart ROM Picker & Multi-Variant Disambiguation:** For multi-archive or multi-ROM releases, **Smart ROM Picker** pre-selects the latest playable version (`v1.10 > v1.9`, `Final > Beta`, `Rev B > Rev A`) aligned with your active Catalog filters. When installing multiple variants or discs from the same release via **Install Options…**, automatic multi-pass collision disambiguation preserves clean base filenames while appending only the unique differentiator (such as `[Improved Controls v3.1]` or `(Disc 1)`/`(Disc 2)`), plus live amber duplicate-path warnings in the review modal.
- **Zero-RAM-Bloat Byte Streaming & Wake Lock:** Streams extracted ROMs (or clutter-free repacked `.cue` + `.bin` disc `.zip`s) straight from the server onto your SD card via `FileSystemWritableFileStream` with live stage readouts (`Checking device…`, `Extracting ROM…`, `Installing to <Device>`, `Finalizing…`), byte progress, transfer speed (`MB/s`), Screen Wake Lock, and a collapsible **Background Install Dock**.

*(Using Firefox or Safari, or accessing over plain LAN HTTP? One-click **Download ROM** still streams extracted, clutter-free, cleanly named ROMs directly to your browser downloads folder.)*

---

## 5. In-Place Version Upgrades & Safe Direct Uninstall

- **Automatic In-Place Upgrades:** When a newer version of an installed ROM hack or translation arrives, `rgt-sync` writes the new file to your SD card, verifies completion, and cleanly deletes the superseded older-version file so duplicate versions never pile up in your handheld menu.
- **Safe Direct Uninstall from `<Device>`:** Remove a single game from **Game Details → More → Uninstall from `<Device>`** or remove hundreds across pages from the Catalog bulk selection bar (with live `Removing X / Y…` progress and a responsive **`Cancel Uninstall`** button that flushes only the files already deleted before cancellation). Uninstall is strictly path-confined to the mounted external device handle, handles shifted mount roots and FAT32 punctuation/type-subfolder fallbacks cleanly, verifies `readwrite` permission upfront, and **never touches your local RGT Sync archival mirror**.

---

## 6. CRT Display Studio, Soundtrack & Trophy Case

Personalize your console from the lower-left sidebar and top header:

- **7 Phosphor Palettes & 4 Monitor Presets:** Switch across **Green**, **Amber**, and **Cyan** starter phosphors—plus **DMG Olive**, **Synthwave**, **Virtual Boy**, and **Trinitron** unlockable collector palettes—paired with **Subtle**, **Sony PVM**, **90s Arcade**, and **BVM** presets or fine-grained FX sliders (Scanlines, Phosphor Glow, Vignette, Aperture Grille, Chromatic Aberration). The browser tab cartridge favicon and theme color sync dynamically to your active palette.
- **5-Level Living UI Motion (`Off` → `Ultra`) & Phosphor Dissolve Notices:** Scale UI choreography from completely still (`Off`, also respecting `prefers-reduced-motion`) up to sweeping cathode-ray edge traces and the **Speed-Reactive Sync Wave**, while ephemeral confirmation banners softly phosphor-dissolve with a hover-pausable decay hairline and smooth zero-jump collapse.
- **Built-In Retro VGM Sound Deck & Trophy Case:** Enjoy **7 original multi-section Web Audio synthesizer tracks** (strictly off by default, auto-pausing on hidden tabs and ducking during chimes) with a center-stage CRT stereo deck, plus unlockable trophies and cosmetics earned naturally as you curate and deploy games.
