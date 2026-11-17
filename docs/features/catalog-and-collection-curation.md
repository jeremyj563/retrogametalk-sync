# Offline Library Catalog, Rich Metadata & Archive Inspection

Once `rgt-sync` discovers and mirrors games into your repository, the **Catalog** workspace turns your archive into a fast, visual, searchable museum of classic gaming—completely hosted on your own hardware.

---

## 1. Visual Game Browser & Per-System Disk Breakdown

- **Box-Art Grid & Detailed Release Cards**: Browse thousands of titles with locally cached cover art, console labels, release year, region/language indicators, release-type tags (`Retail ROM`, `Translation`, `Hack`, `Homebrew`, `Undub`), file sizes, and SD card installation status.
- **Rich Game Detail Drawer & Screenshot Lightbox**: Click any game to open its full preservation dossier:
  - Publisher, developer, release year, genres, regions, languages, and release notes/descriptions
  - Locally mirrored screenshots with one-click **full-resolution upgrade & lightbox viewer**
  - Every individual file belonging to that release (e.g., base game, v1.1 bugfix, optional soundtrack, or alternate translation patch) with individual download, Prepared ROM extraction, and retry controls
- **Per-System Disk Space & Sidebar Telemetry**: The **Mirrored Systems** list in the left sidebar shows exact physical disk space and game counts for every console in your archive. Hover (or keyboard-focus) any system to pop open a detailed console telemetry card showing:
  - Full platform name and manufacturer
  - Exact disk footprint and percentage share of your total archive
  - Mirrored vs. total releases (`%` complete), active queue/failed counts, total archive files on disk, and average size per release
  - How many games from that console are currently marked **Installed** on your handheld/SD card, its configured target device folder, and last activity time

---

## 2. Deep Multi-Faceted Search & `ANY` / `ALL` Filtering

Finding *"all English-translated Japanese SNES RPGs that I haven't put on my handheld yet"* takes just a few clicks:

- **Instant Keyword Search**: Search across titles, filenames, publishers, developers, and descriptions.
- **Combinable Facet Dropdowns with Live Counts**: Filter simultaneously by:
  - **System / Console** (e.g., SNES, GBA, PlayStation, Sega Saturn, PC Engine CD)
  - **Release Type** (Retail ROM, Hack, Translation, Homebrew, Port, Prototype, etc.)
  - **Genre** (RPG, Platformer, Shoot 'em Up, Action, Strategy, etc.)
  - **Region** (USA, Japan, Europe, World, etc.)
  - **Language** (English, Japanese, Spanish, French, etc.)
  - **Source / Group**
  - **Sync Status** (`Downloaded`, `Queued`, `Failed`)
- **`ANY` vs. `ALL` Match Modes**: Multi-select dropdowns let you toggle between matching **ANY** selected tag (broad `OR` search) or requiring **ALL** selected tags simultaneously (precise `AND` search).
- **Toggleable `Installed` & `Not Installed` Filters**: Dedicated toggle buttons let you view:
  - Only games **Installed** on your storage device
  - Only games **Not Installed** yet (great for spotting newly mirrored games to add to your SD card)
  - Everything in your catalog (when neither or both are toggled)
- **Flexible Sorting**: Sort by newest published/updated, recently mirrored, alphabetical (`A → Z` / `Z → A`), largest/smallest file size, or release year.

---

## 3. Inside-the-Archive Inspection & Clutter Stripping

Archived releases often pack extra files alongside the actual game—readme `.txt` files, `.nfo` scene banners, web shortcuts, screenshots, or standalone `.ips`/`.bps` patch files—or store CD games across multiple `.bin` + `.cue` track files.

`rgt-sync` inspects inside `.zip`, `.7z`, `.rar`, and `.tar` archives on the server without unpacking clutter onto your drive:

- **Playable Target Detection**: Automatically identifies playable cartridge ROMs (`.nes`, `.sfc`, `.gba`, `.md`, `.n64`, `.nds`, etc.) and single-file compressed discs (`.chd`, `.rvz`, `.iso`, `.pbp`, `.cso`, `.wbfs`).
- **Smart Multi-Track Disc Bundling**: Recognizes `.cue`, `.gdi`, `.ccd`, and `.m3u` disc descriptors and pairs them with their matching `.bin`/`.img`/audio track files while stripping away readme clutter.
- **Patch-Only Detection**: Clearly flags archives that contain *only* `.ips`, `.bps`, or `.xdelta` patch files (with no playable ROM inside) so you always know whether an archive is ready to boot on hardware/emulators or needs raw archive download for manual patching.
- **Dual Download Options Anytime**:
  - **Prepared ROM Download**: Extracts just the clean playable ROM (or repacks a clutter-free `.cue` + `.bin` disc `.zip` on the fly) using your preferred naming format—ready to drop straight into an emulator or flashcart.
  - **Raw Archive Download**: Downloads the untouched original `.zip`/`.7z`/`.rar` archive exactly as mirrored for archival purists.

---

## 4. On-Disk Repository Browser & Library Maintenance

In **Operations**, a built-in **Repository File Browser** lets you navigate your mirrored directory tree directly from the web UI, check exact folder/file sizes, refresh metadata or high-res artwork on demand, and cleanly delete unwanted files or catalog entries so your database and disk stay in lockstep.
