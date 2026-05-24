## Why

PWA install works on desktop Chrome (Windows) but fails on both Android Chrome and iOS Safari. Each platform has distinct criteria that the current setup doesn't meet.

**Android Chrome** — the "Install" option never appears because the manifest is missing Android-required fields:
- `id` field (Chrome 120+) for persistent PWA identity
- ≥1 `screenshots` entry — without it, the install prompt is suppressed entirely
- Properly padded maskable icons for Android's adaptive icon system
- `description`, `categories`, and `scope` fields for the install dialog

**iOS Safari** — "Add to Home Screen" works (it's a manual Share-sheet action) but the standalone experience is degraded:
- No `apple-mobile-web-app-title` → home screen name falls back to page `<title>`
- No `apple-mobile-web-app-status-bar-style` → status bar is unthemed
- No `viewport-fit=cover` → notched iPhones (X+) show letterboxing instead of full-bleed
- No `apple-touch-icon` at 180×180 → iPhone uses a scaled-down 192×192 icon
- No splash screen (`apple-touch-startup-image`) → white flash on cold launch

This change brings the manifest, icons, and HTML meta tags into Android + iOS compliance.

## What Changes

- **MODIFIED**: `packages/client/src/index.html` — add iOS meta tags (`apple-mobile-web-app-title`, `apple-mobile-web-app-status-bar-style`), update viewport for `viewport-fit=cover`, add `apple-touch-icon` at 180×180, add `crossorigin` to manifest link
- **MODIFIED**: `public/manifest.json` — add `id`, `scope`, `description`, `categories`, `display_override`, and `screenshots` array with a representative screenshot
- **MODIFIED**: `public/sw.js` — add `activate` event handler with `clients.claim()` for immediate service worker control on first install
- **NEW**: `public/screenshot-wide.png` — 1280×720 screenshot of the dashboard for the Android install dialog
- **NEW**: `public/icon-192-maskable.png` — 192×192 maskable icon with ≥40% safe zone padding for Android adaptive icons
- **NEW**: `public/icon-512-maskable.png` — 512×512 maskable icon with ≥40% safe zone padding
- **NEW**: `public/icon-180.png` — 180×180 icon for iPhone `apple-touch-icon`
- **NEW**: `public/icon-180-maskable.png` — 180×180 maskable variant for iPhone
- **MODIFIED**: `openspec/specs/pwa-manifest/spec.md` — add requirements for Android + iOS PWA compliance

## Capabilities

### Modified Capabilities

- `pwa-manifest`: add Android-required manifest fields (`id`, `screenshots`, `description`, `categories`, `scope`, `display_override`), maskable icon variants, iOS-specific meta tags (`apple-mobile-web-app-title`, `apple-mobile-web-app-status-bar-style`, `viewport-fit=cover`, 180×180 touch icon), and service worker `clients.claim()` on activate

## Impact

- **MODIFIED files**:
  - `packages/client/src/index.html` — 4 iOS meta/link tag additions + viewport update + manifest crossorigin
  - `public/manifest.json` — add 7 fields + maskable entries + screenshots
  - `public/sw.js` — add `activate` event with `clients.claim()`
  - `openspec/specs/pwa-manifest/spec.md` — add Android + iOS compliance requirements
- **NEW files**:
  - `public/screenshot-wide.png` — representative dashboard screenshot (1280×720)
  - `public/icon-192-maskable.png` — 192×192 maskable variant
  - `public/icon-512-maskable.png` — 512×512 maskable variant
  - `public/icon-180.png` — 180×180 iPhone touch icon
  - `public/icon-180-maskable.png` — 180×180 iPhone maskable variant
- **Backward compatibility**: All additions are additive. Existing desktop Chrome PWA behavior unchanged. The `id` field matches the existing `start_url` (`/`), preserving PWA identity for any existing desktop installs. iOS `apple-mobile-web-app-capable` meta tag is already present — new tags add UI polish only.

### Platform coverage

| Platform | Install works over | This change helps? |
|---|---|---|
| Desktop Chrome | `http://localhost`, `https://` | ✅ manifest already sufficient, changes are additive |
| Android Chrome | `https://` or `http://localhost` only | ✅ enables install prompt, but **LAN HTTP (`http://192.168.x.x`) is blocked by Chrome policy** — users must use `localhost` (via `adb reverse`) or HTTPS (via tunnel) |
| iOS Safari | `http://` (any), `https://` | ✅ meta tag changes improve standalone UX over any connection

## References

- [Chrome Android PWA install criteria](https://developer.chrome.com/docs/android/install-criteria)
- [Web App Manifest `id` field](https://developer.chrome.com/blog/pwa-manifest-id)
- [Maskable icons spec](https://www.w3.org/TR/appmanifest/#icon-maskable)
- [PWA screenshots for richer install UI](https://developer.chrome.com/docs/web-platform/richer-pwa-install-ui)
- [Safari Web App Meta Tags](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariHTMLRef/Articles/MetaTags.html)
- [iOS viewport-fit for notched iPhones](https://webkit.org/blog/7929/designing-websites-for-iphone-x/)
