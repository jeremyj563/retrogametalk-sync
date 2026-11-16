---
title: Custom Top-Left Header Logo & Animated Banner
status: implemented
created_at: 2026-11-16T19:38:58Z
implemented_at: 2026-11-16T19:40:20Z
---

# Custom Top-Left Header Logo & Animated Banner

Add a server-persisted **Interface Branding** configuration in Operations where operators can set a custom URL for a static or looping animated logo/banner that replaces the top-left `"RetroGameTalk Sync"` header title across all browsers and sessions.

---

### User Review & Critical Decisions

> [!IMPORTANT]
> All placement, persistence, and layout constraints were confirmed during discovery and govern this design:
> - **Header Display Mode**: When configured and loaded cleanly, the custom logo or banner **replaces** the `"RetroGameTalk Sync"` wordmark in the top-left header (while preserving click-to-Sync navigation).
> - **Configuration Location & Scope**: Configured inside **Operations** and persisted in the backend SQLite configuration so branding stays consistent across all browsers and devices.
> - **Sizing Constraint**: Constrained cleanly within the existing sticky top header height (`32px` max height, automatic proportional width up to `240px`) so the top bar never inflates vertically or crowds the Sync controls.

---

### 1. Overview & Core Concept

- **What It Does**: Allows administrators to paste any valid image or looping animation URL in Operations (`Interface Branding`) to customize the top-left brand slot of the application header.
- **Target User**: Self-hosted operators personalizing their RetroGameTalk Sync instance with custom pixel-art logos, CRT badges, or animated GIF/WebP/APNG/video banners.
- **Key Value**: Lets instances showcase custom retro branding in the top-left corner while guaranteeing sticky-header stability, automatic cross-device persistence, and zero broken-image states.

---

### 2. User Experience & Visual Design

- **Key User Flows**:
  1. **Configuring in Operations**: Under a new **Interface Branding** section in Operations, the user enters a logo/banner URL (supporting animated `GIF`, `APNG`, `WebP`, `PNG`, `SVG`, or looping `MP4`/`WebM` streams) and immediately sees a scaled **Live Header Preview** inside a simulated top-bar strip.
  2. **Dirty State & Saving**: Typing or clearing the URL integrates seamlessly into Operations' dirty-change tracking—activating the sticky bottom `Save Changes` / `Discard` bar and the tab-switch guard modal until saved.
  3. **Top-Left Header Rendering**: Once saved, the top-left brand link renders the custom graphic instead of `"RetroGameTalk Sync"`. Animated image formats loop continuously out of the box, and video URLs auto-play silently in a seamless loop (`autoPlay`, `loop`, `muted`, `playsInline`).
  4. **Clearing or Broken-URL Resilience**: Clearing the input (via the `Restore Default Title` button or emptying the field and saving) restores the `"RetroGameTalk Sync"` wordmark. If an external URL fails to load or errors, the header automatically falls back to `"RetroGameTalk Sync"` rather than displaying a broken image placeholder, while the Operations preview surfaces a clear inline load-failure notice.

- **Visual Identity & Theme**:
  - Follows the existing CRT terminal design system (`--color-crt-surface`, `--color-crt-bg`, hairline `--color-crt-border` framing, clean single-elevation cards, and zero-pill inline metadata hints).
  - The custom brand asset sits inside the existing `<a>` home link with `max-h-8 w-auto max-w-[240px] object-contain` (plus clean `object-left`), keeping the header bar at its exact existing height and preserving `whitespace-nowrap shrink-0` alignment with the Sync scope and Run controls on the right.
  - Under `prefers-reduced-motion: reduce`, `<video>` playback pauses automatically while standard `<img>` animations follow browser reduced-motion settings.

---

### 3. Key Product Decisions & Trade-Offs

- **Decision 1: Server-Side SQLite Persistence (`v11` Migration) vs. Browser `localStorage`**
  - *Chosen Approach*: Store `custom_brand_logo_url` on the singleton configuration record via an automated `v11` SQLite schema migration and expose it through `GET/PUT /api/config`.
  - *Why*: Matches the user's requirement for cross-browser persistence and integrates naturally with Operations' existing `Save Changes` / `Discard` / unsaved-guard workflow.
  - *Alternatives Considered*: Browser-local `localStorage` (similar to CRT visual FX sliders), which would lose branding when opening the dashboard from another device or browser.

- **Decision 2: Dual Media Rendering (`<img>` + Looping `<video>` Auto-Detection)**
  - *Chosen Approach*: Render standard image and animated image URLs (`GIF`, `APNG`, `WebP`, `SVG`, `PNG`, `AVIF`) as `<img referrerPolicy="no-referrer">`, while automatically detecting `.mp4`, `.webm`, `.m4v`, and `.mov` URLs and rendering them in a muted looping `<video>` element.
  - *Why*: Covers true looping image files (`GIF`, animated `WebP`, `APNG`) natively with zero configuration, while also handling animated banner clips exported as lightweight `MP4`/`WebM` loops.
  - *Alternatives Considered*: Restricting exclusively to `<img>`, which fails silently if a user pastes a looping `.webm` or `.mp4` banner link.

- **Decision 3: Strict URL Protocol Validation & Non-Fatal Runtime Fallback**
  - *Chosen Approach*: Validate non-empty inputs on save to allow only `http://`, `https://`, or root-relative `/...` asset paths (rejecting `javascript:` or malformed strings with a clear validation message), and fall back to the `"RetroGameTalk Sync"` text mark whenever runtime loading fails (`onError`).
  - *Why*: Prevents XSS/invalid URLs from persisting to the database while ensuring an unreachable third-party CDN never leaves the top-left header blank or broken.

---

### 4. Technical Architecture & Data Strategy

#### System & Component Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Sticky Top Header (All Views)                                            │
│                                                                          │
│  ┌─ Top-Left Brand Link (#monitor) ───────────────────────────────────┐  │
│  │ • Empty URL or Load Error ─▶ "RetroGameTalk Sync" (display text)   │  │
│  │ • Image / GIF / WebP / APNG ─▶ <img> (max-h-8, w-auto, max-w-240px)│  │
│  │ • Video (.mp4/.webm) ─▶ <video autoPlay loop muted playsInline>    │  │
│  └────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────┘
                                       ▲
                                       │ config.customBrandLogoUrl
┌──────────────────────────────────────┴───────────────────────────────────┐
│ Operations View (Interface Branding Section)                             │
│                                                                          │
│  [ Custom Logo / Banner URL input ]  [ Restore Default Title ]           │
│  Live Header Preview Strip (shows 32px constrained brand or error note)  │
│       │                                                                  │
│       ▼ (joins Operations dirty tracking & sticky Save / Discard bar)    │
│  PUT /api/config  ──▶  SQLite scraper_config.custom_brand_logo_url (v11) │
└──────────────────────────────────────────────────────────────────────────┘
```

#### Data Model, Validation & State Flow

- **Database & API Contract**:
  - Added schema migration `v11` appending `custom_brand_logo_url TEXT NOT NULL DEFAULT ''` to `scraper_config`.
  - Extended public configuration and update payload types with `customBrandLogoUrl: string`.
  - Normalized whitespace on save; empty string clears the banner, while non-empty URLs validate `http://`, `https://`, or root-relative `/...` paths before persisting.
- **Operations Panel State**:
  - Tracked `customBrandLogoUrl` in Operations form state alongside existing settings, synced via `resetFormToConfig`, `buildSavePayload`, and `dirtyState` (`changedSections` reports `"Interface Branding"` when modified).
  - Tracked preview load-error state independently from `url` changes so users receive immediate load feedback before saving.
- **Top-Left Header Component State**:
  - Extracted a reusable `BrandMark` component used by both the sticky top header and the Operations live preview strip, keeping sizing containment, image/video switching, `referrerPolicy="no-referrer"`, and `onError` fallback behavior identical across both places.
