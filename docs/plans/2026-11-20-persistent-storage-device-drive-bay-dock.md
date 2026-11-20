---
title: Persistent Storage Device Drive Bay Dock
status: implemented
created_at: 2026-11-20T23:34:46Z
implemented_at: 2026-11-20T23:38:00Z
---

# Persistent Storage Device Drive Bay Dock

Move **Mount Storage Device** out of the crowded Catalog toolbar row and into a dedicated, persistent **Storage Device Drive Bay** in the left sidebar—styled like a recessed hardware SD/cartridge slot with live phosphor LED state, unmistakable mount affordance, and one-click **Switch**, **Eject**, and **Auto-Configure** actions.

---

## User Review & Critical Decisions

> [!IMPORTANT]
> All core placement, visual style, and post-mount action choices below were confirmed during discovery.

- **Confirmed — Placement**: Lives permanently in the **left sidebar rail** directly beneath the main navigation links (above **Service Telemetry**) so it is immediately visible on **Catalog**, **Monitor**, **Device Export**, and every other view. The buried duplicate button in the Catalog toolbar row is removed.
- **Confirmed — Visual Style**: Styled as a **recessed hardware drive bay with phosphor LED state**, echoing the workstation's existing recessed hardware instruments (Stereo Sound Deck and CRT Display Tuner) with machined slot framing, illuminated device readout, and a real live status LED paired with explicit text labels (`Standby` / `Mounted` / `Writing`).
- **Confirmed — Mounted Quick Actions**: Once mounted, displays the **device/folder name** in a recessed phosphor LCD readout alongside dedicated **Switch**, **Eject**, and **Auto-Configure** actions.
- **Default — Auto-Configure Shortcut Behavior**: Clicking **Auto-Configure** in the mounted drive bay switches to **Device Export → Storage Device Folder Mappings**, spotlights the section, and immediately initiates the non-destructive **Auto-Configure Preview** scan for the mounted device.
- **Default — Accurate LAN HTTP / Secure Context Guidance**: Updates File System Access capability detection (`evaluateFileSystemAccessSupport`) to distinguish insecure LAN HTTP origins (`!window.isSecureContext`) from non-Chromium browsers, surfacing clear HTTPS / Chrome flag guidance inside the drive bay when blocked.
