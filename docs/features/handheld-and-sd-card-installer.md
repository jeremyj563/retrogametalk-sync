# Direct Handheld / SD Card Installer, Smart ROM Picker & Folder Mappings

Whether you play on an Anbernic, Miyoo Mini, Retroid, TrimUI, Steam Deck, Analogue Pocket, MiSTer FPGA, or original console flashcart (EverDrive / FXPAK Pro / Terraonion / Fenrir), getting mirrored games onto your SD card shouldn't mean spending Saturday afternoon unzipping folders and fixing filenames.

`rgt-sync` lets you **plug your SD card or USB drive into your computer and install extracted, cleanly named ROMs directly from your browser**.

---

## 1. Direct Browser-to-SD-Card Installation

Using Chromium-based browsers (Chrome, Edge, Brave, Vivaldi, Arc, Opera), `rgt-sync` writes directly to any folder or removable drive you select:

1. Select a single game, multi-select a curated handful in the **Catalog**, or select **all matching results** from your current filter (e.g., *all downloaded GBA English Translations not yet installed*).
2. Choose **Express Install** (one-click smart selection) or **Review & Install** (preview and tweak every file, variant, and output name first).
3. Pick your SD card root directory once in the OS folder picker.
4. `rgt-sync` streams extracted, clutter-free ROMs straight from your server onto the right console folders on your SD card—preventing your computer from falling asleep mid-transfer and letting you minimize the installer into a **Background Install Dock** while you keep browsing!

*(Using Firefox or Safari? You can still download individual Prepared ROMs with full clutter stripping and clean FAT32 naming right from any game card or detail drawer.)*

---

## 2. Clean, FAT32-Friendly ROM Naming

Handheld firmwares and classic hardware flashcarts can be picky about special characters, scene dump noise, and overly long filenames. In **Operations**, you can customize how Prepared ROMs are named once and apply it everywhere:

- **Readable Structured Naming**: Cleanly formats filenames from catalog titles with optional toggles for:
  - **Region Tags** — e.g., `(USA)`, `(Japan)`
  - **Role Badges** — e.g., `[T-En]`, `[Hack]`, `[Undub]`, `[Homebrew]`
  - **Detected Version Tags** — e.g., `(v1.42)`, `(Rev B)`
- **FAT32 Sanitization & Length Limits**: Automatically strips illegal filesystem characters (`:`, `?`, `*`, `"`, `<`, `>`, `|`, control chars) and enforces a configurable maximum filename length so transfers to FAT32 and exFAT cards never fail mid-copy.
- **Format-Appropriate Output**: Cartridge ROMs (`.nes`, `.sfc`, `.gb`, `.gba`, `.md`, `.n64`, etc.) and single-file discs (`.chd`, `.rvz`, `.iso`, `.pbp`) extract directly as ready-to-boot files, while multi-track `.cue` + `.bin` CD games are automatically repacked on the fly into clean, clutter-free `.zip` bundles.

---

## 3. Smart ROM Picker (Automatic Best-Version Selection)

Many retro releases—especially ROM hacks, translations, and multi-region sets—include multiple archives or multiple inner ROM variants (for example, `v1.0`, `v1.1`, `v1.2 Hotfix`, optional `ハードモード / Hard Mode`, or `USA` vs. `Europe`).

Instead of forcing you to expand 50 games by hand, `rgt-sync`'s **Smart ROM Picker** evaluates every candidate automatically:

- **Version-Aware Intelligence**: Understands semantic versions (`v2.1` > `v1.9`), build dates (`2026-04-12` > `2025-11-03`), revisions (`Rev B` > `Rev A`), and release maturity (`Hotfix / Final` > `Stable` > `RC` > `Beta` > `Alpha`).
- **Filter-Context Awareness**: Honors the filters you used in the Catalog! If you filtered the Catalog for **Translations** + **English**, Smart ROM Picker prioritizes the English-patched playable ROM over an unpatched Japanese base ROM or bonus soundtrack archive—and explains *why* each target was chosen right in the Review modal.
- **Full Manual Override Anytime**: In the **Install Prepared ROMs** review modal, multi-choice releases are highlighted so you can check additional variants (e.g., installing both the Normal and Randomizer versions) or edit any output filename before writing.

---

## 4. Automatic In-Place Version Upgrades on Your SD Card

Following active ROM hack or translation projects? When `Chrono Trigger+ (USA) [Hack] (v2.5).sfc` is already sitting on your SD card and a sync pulls down `v2.6`:

- `rgt-sync` scans your SD card's target console folder before writing, recognizes `v2.5` as an older version of the exact same title and role, writes `v2.6`, and **cleanly removes the superseded `v2.5` file** so you don't end up with duplicate outdated versions cluttering your handheld menu.
- Every installed game is automatically marked **Installed** in your Catalog (with manual Mark Installed / Mark Not Installed controls available too if you ever reformat or swap SD cards).

---

## 5. Customizable Console & ROM-Type Folder Mappings

Different handheld firmwares and frontends organize ROM folders differently—and many collectors love keeping Hacks, Translations, and Homebrew neatly separated inside each console folder rather than mixed into thousands of retail titles.

In **Operations → Storage Folder Mappings**, you configure your folder layout once and `rgt-sync` remembers it permanently in its database:

- **Sensible Defaults Out of the Box**: Every supported system ships with clean, standard default folder names (`snes`, `nes`, `gb`, `gbc`, `gba`, `nds`, `n64`, `genesis`, `dreamcast`, `psx`, `psp`, `pce`, etc.) that work across most common frontends and devices—with instant per-console editing whenever your setup uses custom names (such as `SFC` or `Roms/FC`).
- **Opt-In ROM-Type Subfolders**: Keep everything in a single console folder by default, or flip on **Categorize by ROM Type Subfolders** to organize non-retail categories automatically:
  - By default when enabled, **Retail ROMs** stay in the console root (`/snes/`) while **ROM Hacks** (`/snes/Hacks/`), **Translations** (`/snes/Translations/`), **Homebrew** (`/snes/Homebrew/`), **Ports** (`/snes/Ports/`), and **Prototypes/Betas** (`/snes/Prototypes/`) file neatly into dedicated subdirectories.
  - Customize global subfolder names once, and optionally add **per-system subfolder overrides** for specific consoles where your firmware or flashcart expects a custom layout.

---

## 6. Personalize Your Console: The CRT Display Studio

Preservation tools should feel inspiring to use! Open the **CRT Display** control in the lower-left sidebar to tailor the interface to your favorite classic monitor aesthetic:

- **Phosphor Palettes**: Switch instantly between classic **P1 Green**, **P3 Amber**, and **VFD Cyan** phosphor themes.
- **Monitor Presets & Fine-Tuning Sliders**: Choose **Subtle**, **Sony PVM**, or **90s Arcade**, or dial in custom sliders for **Scanlines**, **Phosphor Glow**, **Tube Vignette**, **Aperture Grille**, and **RGB Chromatic Aberration**—or toggle CRT effects completely off for a crisp modern dark UI.
- **5-Level UI Motion Control (`Off` → `Ultra`)**: Keep the interface completely still (`Off`) for distraction-free curation, enjoy subtle active indicators (`Low` / `Medium`), or crank it to `High` / `Ultra` for sweeping cathode-ray edge traces and rolling V-sync hum bars.
