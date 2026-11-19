---
title: Smooth Mellow Transitions for Catalog Item Details Drawer
status: implemented
created_at: 2026-11-19T05:22:04Z
implemented_at: 2026-11-19T05:27:00Z
---

# Smooth Mellow Transitions for Catalog Item Details Drawer

Replace the instant snap-open and snap-close of the Catalog item details drawer with an unhurried, compositor-driven slide-in from the right, paired with a soft backdrop fade and subtle directional crossfade when stepping between adjacent titles.

---

## User Review & Critical Decisions

> [!IMPORTANT]
> All core motion preferences were confirmed during clarification and are locked into this plan:
>
> - **Drawer Open & Close Style**: Mellow slide-in from the right edge paired with a soft backdrop fade.
> - **Transition Scope**: Drawer open/close plus smooth directional Prev/Next item crossfade inside the open drawer.
> - **Living UI Motion Off Behavior**: Retain a gentle, subtle transition when Living UI Motion is set to `Off`, and reserve instant/minimal transitions strictly for the OS `prefers-reduced-motion: reduce` accessibility preference.

---

## 1. Overview & Core Concept

- **What It Does**: Adds cohesive enter, exit, and item-switching motion to the slide-over Game Detail Drawer so inspecting titles from the Catalog (or Failed Queue) feels calm, intentional, and visually unified with the rest of the CRT console's mellow transitions.
- **Target Audience / Persona**: RetroGameTalk Sync operators browsing large ROM libraries, flipping through covers/screenshots with Previous/Next controls or arrow keys, and checking release notes or archive contents.
- **Key Value**: Eliminates the jarring full-panel flash when opening, closing, or stepping between catalog titles while preserving zero-latency access to all controls and keeping background lazy metadata hydration uninterrupted.

---

## 2. User Experience & Visual Design

### Key User Flows

1. **Opening a Catalog Title**:
   - Clicking any catalog card or list row immediately mounts the drawer with its backdrop at `opacity: 0` and the right-hand detail panel positioned slightly off-edge (`translate3d(44px, 0, 0)` with `opacity: 0`).
   - On the next animation frame, the backdrop dissolves smoothly into a soft darkened scrim while the detail panel glides into place along the app's signature deceleration curve (`cubic-bezier(0.22, 1, 0.36, 1)`) over `380ms`.
   - Interactive controls (Close, Prev/Next, Queue/Download, Export) are immediately clickable without waiting for the animation to settle.
2. **Closing the Drawer (Close button, backdrop click, or `Escape`)**:
   - Rather than vanishing immediately when the parent clears the selected item, the drawer retains the last rendered item snapshot during a crisp, gentle `260ms` exit glide (`translate3d(36px, 0, 0)` + `opacity: 0`) while the backdrop fades out simultaneously.
   - Backdrop and panel disable pointer events during the closing phase so users can immediately click another catalog card underneath without hitting an invisible overlay.
   - If the user clicks another catalog item mid-close, the closing timer cancels cleanly and the drawer smoothly glides back open with the newly selected item.
3. **Stepping Through Items (`Prev` / `Next` buttons or `ArrowLeft` / `ArrowRight`)**:
   - The outer drawer shell, backdrop, and sticky header navigation chrome stay anchored in place (zero shell flicker).
   - Inside the scrollable body and title header, the newly selected item performs a soft directional settle: stepping **Next** enters with a gentle `14px` leftward drift (`+14px -> 0`), and stepping **Previous** enters with a gentle `14px` rightward drift (`-14px -> 0`) paired with a `280ms` opacity dissolve.
   - The scroll container resets cleanly to top as the new item settles in, while existing CRT skeleton placeholders continue to dissolve smoothly into hydrated artwork and specs.

### Interactive Feedback, Motion Curves & Accessibility

- **Signature Curve**: `cubic-bezier(0.22, 1, 0.36, 1)` for smooth deceleration with zero spring overshoot.
- **Compositor-Only Animation**: Strictly animates `transform` (`translate3d`) and `opacity`.
- **Timing Budget**:
  - Open glide: `380ms` panel transform + `320ms` backdrop opacity.
  - Close glide: `260ms` panel transform + `240ms` backdrop opacity.
  - Prev/Next item swap: `280ms` directional fade-and-settle (`±14px` horizontal drift).
- **Living UI Motion = `Off`**: Uses a gentler, shorter transition (`220ms` open / `180ms` close / `180ms` item fade with tighter `18px` slide distance).
- **OS `prefers-reduced-motion: reduce`**: Collapses horizontal slide translations to `0px` and shortens opacity transitions to a motion-safe `100ms` dissolve.
