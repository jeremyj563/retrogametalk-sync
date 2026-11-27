# Offline Library Catalog, Collections, Curation & Archive Explorer

Once `rgt-sync` indexes and mirrors releases into your repository, the **Catalog** workspace transforms your local storage into a fast, visual **retro game content management system (CMS)**—complete with personal collections, multi-device tracking, update alerts, in-place archive browsing, and direct disk management.

---

## 1. Visual Game Browser & Three View Modes

Switch seamlessly between three Catalog layouts without losing your search or filter context:

- **Box-Art Grid:** Browse thousands of releases with locally cached cover art, console badges, release year, region/language indicators, release-type tags (`Retail ROM`, `Translation`, `Hack`, `Homebrew`, `Port`, `Undub`, `Prototype`), favorite stars, multi-device install badges (`Installed · Miyoo Mini +1`), update cues (`Update ready` / `Update on RGT`), and 1-click **Install / Update / Reinstall** or **Queue** buttons.
- **Detailed List:** Compact tabular view showing titles, systems, file sizes, sync status, device install status, and quick action buttons for fast high-density curation.
- **Local Disk Tree:** A viewport-bounded CRT file explorer for browsing your physical `DOWNLOAD_DIR` directory hierarchy directly from the browser—featuring interactive path breadcrumbs, one-click path copy, folder filtering, column sorting (`Name A–Z`, `Name Z–A`, `Largest First`, `Recently Modified`), scroll-offset memory when navigating back up, direct local file downloads, safe 2-step folder/file deletion, and **click-to-open archive inspection** directly inside the directory tree.

### Rich Game Detail Drawer & Screenshot Lightbox
Click any game—from the **Catalog** or straight from the active **Sync Hero Showcase**—to open its preservation & deployment dossier:
- Publisher, developer, release year, genres, regions, languages, collection chips, and full release notes
- Locally cached cover art and screenshots with a GPU-composited **full-resolution lightbox viewer** (smooth directional crossfades, `Fit Screen` / `1:1 Pixel` toggle, adjacent slide preloading)
- **Mount-Aware Primary Action Footer:** When a storage device is mounted, **Install to `<Device>`** (or **Update** / **Reinstall**) takes primary focus right beside 1-click **Download ROM** (automatically picking the latest playable version, or opening a compact docked **Choose ROM Variant** strip for multi-variant archives)
- **Inline Archive Inspection:** Every mirrored `.zip`, `.7z`, `.rar`, or `.tar` under **Included Downloads** has a clickable filename and inline **Inspect / Hide Contents** toggle—no menu diving required
- **Consolidated `More (···)` Menu:** Houses **Install Options…**, **Download Raw Archive**, **Pin / Ignore Sync Override**, **Uninstall from `<Device>`**, **Refresh / Fetch Metadata**, **Mark / Clear Installed Flag**, **Dry Run Retry**, and 2-step **Delete Release**

---

## 2. Favorites, Custom Collections & Handheld Loadouts

Turn your archive into curated libraries and ready-to-deploy handheld loadouts:

- **One-Click Favorites:** Toggle the Star icon on any Grid card, List row, or Game Detail header, and filter straight to **Favorites (`N`)** from the Catalog toolbar.
- **Custom Collections:** Use the **Collection** dropdown (`All Collections`, `Favorites`, custom collections with live counts, `+ New Collection…`) to create named lists—such as *"Miyoo Mini Travel Pack"*, *"SNES English RPGs"*, *"Co-op Arcade Night"*, or *"Analogue Pocket Essentials"*.
- **Contextual Collection Banner:** Selecting any collection surfaces an action strip with 1-click **`Queue Missing (N)`** (downloads any un-mirrored titles in that collection), **`Install to <Device> (N)`** (deploys the entire loadout to your plugged-in SD card), plus inline **Rename** and **Delete**.
- **Bulk Curation:** Multi-select cards across pages (`Select visible` or `Select all matching`) and use the **`+ Collection`** popover to add/remove games in bulk, or assign tags straight inside the Game Detail drawer.

---

## 3. Per-Game Sync Rule Overrides (`Pin` & `Ignore`)

Sometimes global console and release-type rules aren't granular enough—maybe you only mirror *SNES Translations* globally, yet you always want one specific *PS1 Retail* classic preserved, or you want to skip a massive multi-disc demo you don't care about:

- **Pin (`pin`):** Forces a release to always match Sync Rules during Full Sync, Incremental Sync, Pre-Flight, and the Catalog `Matches Sync Rules` filter—even if its console or release type is excluded globally.
- **Ignore (`ignore`):** Excludes a release from automatic Full and Incremental Syncs without blocking you from manually queueing or installing it later.
- Manage overrides per game in **Game Details → More** or in bulk via the Catalog selection bar, and filter directly by **Pinned** or **Ignored** inside **More Filters**.

---

## 4. Streamlined Multi-Facet Filtering & Multi-Device Offline Scoping

Finding *"all English-translated Japanese SNES RPGs that aren't installed on my Miyoo Mini yet"* takes just a few clicks:

- **Clean Progressive Toolbar:** **Search**, **Systems**, **Types**, a collapsible **More Filters** drawer (`Genres`, `Regions`, `Languages`, `Sources`, `Status`, `Pinned`/`Ignored`), and **Sort** (including **`Recently Installed`**, newest published/updated, recently downloaded, alphabetical, size, and year) sit on one balanced row.
- **`ANY` vs. `ALL` Match Modes:** Toggle multi-select dropdowns between broad `OR` matching (**ANY**) and strict `AND` matching (**ALL**).
- **Status & Sync Rule Tracks:** Filter quickly by **`Matches Sync Rules`**, **Downloaded / Not Downloaded**, and a unified **Device Scope + Install Track** (`Device Selector · Installed / Not Installed / Updates`).
- **Offline Saved-Device Filtering:** The searchable Device Scope dropdown is grouped by **Any Device**, **Mounted Now**, **Pinned**, **Saved Devices**, and **Archived**—letting you inspect what's installed, missing, or outdated on *any* handheld in your fleet even when its SD card is sitting on your desk unplugged.
- **Grouped Active Filter Chips:** Multi-select filters collapse into compact 1-click summary chips (e.g., `Systems: 12 selected`) with click-to-edit and hover tooltips so active filters never turn into a wall of badges.

---

## 5. Installed ROM Update Detection

Following actively developed ROM hacks and fan translations? `rgt-sync` tracks the exact file ID and filename installed on each device and flags version drift automatically:

- **`Update ready` (Local Newer Mirror):** A newer version of an installed release is already mirrored on your server—click **Update** on the card, drawer, **Updates (`N`)** toolbar strip, or Sidebar Drive Bay **Update All** shortcut to stream the new file and remove the superseded older ROM from your SD card.
- **`Update on RGT` (Upstream Update):** RetroGameTalk has a genuinely newer archive file not yet mirrored locally (metadata-only WordPress description/tag edits are filtered out to prevent false positives). Click **Download Update** (or **Download Updates (`M`)** in batch) to mirror the new release first, then deploy it to your device.

---

## 6. In-Place Archive Explorer & Clutter Stripping

Archived releases frequently bundle `.txt`/`.nfo` scene notes, web links, screenshots, or standalone `.ips`/`.bps` patches—or store optical disc games across multiple `.bin` + `.cue` track files.

`rgt-sync` inspects `.zip`, `.7z`, `.rar` (including RAR4, RAR5, and solid archives via native `unrar`), and `.tar` archives on the server with **zero temporary disk extraction**:

- **Interactive Archive Browser:** Drill into nested archive directories with breadcrumbs, search inner entries, view category badges (`ROM`, `DISC`, `PATCH`, `DOC`, `ARCHIVE`) and uncompressed sizes, read UTF-8 text previews of `.txt`/`.nfo`/`.md`/`.cue`/`.m3u` files (with copy button and 128 KB guard), and stream-download any single inner file.
- **Smart Playable Target Detection:** Automatically identifies cartridge ROMs (including disambiguating Sega Genesis `.md` ROMs from Markdown READMEs), single-file compressed discs (`.chd`, `.rvz`, `.iso`, `.pbp`, `.cso`, `.wbfs`), multi-track disc bundles (`.cue`/`.gdi`/`.ccd`/`.m3u` + sibling tracks), and **patch-only** archives.
- **Dual Download Options Anytime:**
  - **Download ROM (Prepared):** One-click clean extraction (or on-the-fly clutter-free `.zip` repacking for multi-track discs) formatted with your chosen ROM naming rules.
  - **Download Raw Archive:** Downloads the untouched original `.zip`/`.7z`/`.rar` exactly as mirrored.
