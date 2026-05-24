## Context

The dashboard already has a basic PWA setup (`manifest.json` + `sw.js` + `useInstallPrompt` hook) that works on desktop Chrome. Desktop Chrome shows the install prompt when:
- The site has a valid manifest with `name`, `icons`, `start_url`, and `display`
- A service worker with a `fetch` handler is registered
- The user has visited the site at least twice in 24 hours

Android Chrome and iOS Safari each apply additional checks beyond what desktop Chrome requires. The two platforms have largely disjoint criteria — Android relies on manifest fields; iOS relies on proprietary `<meta>` / `<link>` tags.

## Android Chrome PWA Requirements

### Currently satisfied
| Requirement | Status | Evidence |
|---|---|---|
| HTTPS or localhost | ⚠️ depends | Works over zrok tunnel (HTTPS). Fails on direct LAN HTTP. Out of scope — tunnel is the supported path. |
| Valid manifest | ✅ | `name`, `short_name`, `start_url`, `display`, `icons`, `theme_color`, `background_color` |
| Service worker with fetch handler | ✅ | `sw.js` passes through to network |
| 192×192 and 512×512 PNG icons | ✅ | `icon-192.png`, `icon-512.png` exist |
| `display: standalone` | ✅ | Set in manifest |
| `theme-color` meta tag | ✅ | Present in `index.html` |

### Currently missing (this change)
| Requirement | Status | Fix |
|---|---|---|
| `id` field | ❌ | Add `"id": "/"` to manifest |
| `screenshots` (≥1) | ❌ | Add wide screenshot of dashboard UI |
| Maskable icon with safe zone | ❌ | Generate padded maskable icon variants |
| `description` | ❌ | Add description field |
| `categories` | ❌ | Add `["productivity", "utilities"]` |
| `scope` | ❌ | Add explicit `"scope": "/"` |
| `display_override` | ❌ | Add `["standalone", "window-controls-overlay"]` |
| `clients.claim()` on activate | ❌ | Add `activate` handler to `sw.js` |

### Out of scope
| Issue | Rationale |
|---|---|
| HTTPS for direct LAN access | Android Chrome requires HTTPS for PWA install; `http://192.168.x.x` is not `localhost`. The manifest/screenshots changes here are necessary but not sufficient for LAN users — they need either a tunnel (zrok) providing HTTPS, port-forwarding from `localhost` via `adb reverse`, or a self-signed cert. Self-signed certs cause scary browser warnings and are a separate effort. |
| `related_applications` / Play Store listing | No Play Store listing exists. |
| `shortcuts` | No common deep-link targets yet. Can add later. |
| Workbox / caching strategies | Current SW intentionally passes through — the dashboard is a local server. |

## Manifest field design

```json
{
  "name": "PI Dashboard",
  "short_name": "PI Dash",
  "id": "/",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "display_override": ["standalone", "window-controls-overlay"],
  "description": "Monitor and interact with pi agent sessions",
  "categories": ["productivity", "utilities"],
  "theme_color": "#3b82f6",
  "background_color": "#0f172a",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" },
    { "src": "/icon-192-maskable.png", "sizes": "192x192", "type": "image/png", "purpose": "maskable" },
    { "src": "/icon-512-maskable.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ],
  "screenshots": [
    {
      "src": "/screenshot-wide.png",
      "sizes": "1280x720",
      "type": "image/png",
      "form_factor": "wide"
    }
  ]
}
```

Key design decisions:

1. **`id: "/"`** — Matches existing `start_url`. Preserves PWA identity for any desktop installs. Chrome uses `id` + `start_url` to detect manifest changes; an `id` change would orphan existing desktop installs.

2. **Separate maskable icon files** — Rather than adding `"purpose": "maskable"` to the existing icons (which lack safe zone padding), create dedicated padded variants. Existing `any` icons remain for favicon/apple-touch-icon use where full-bleed is fine.

3. **`display_override`** — `"window-controls-overlay"` is included for future desktop PWA title bar customization. Android ignores unrecognized override values. Prefer `"standalone"` first as the primary display mode.

4. **Single wide screenshot** — One representative screenshot is the minimum Android Chrome needs. A `form_factor: "wide"` 1280×720 screenshot covers the most common Android aspect ratio. Narrow (phone-shaped) screenshots are optional; Chrome falls back to wide if narrow is absent.

## Maskable icon safe zone

Android applies a circular mask (or squircles on some OEMs) to adaptive icons. The safe zone is the inner 66.67% of the icon — roughly 40% padding on each side.

```
┌────────────────────────────┐
│  ┌──────────────────────┐  │
│  │                      │  │ ← safe zone (center ~66.67%)
│  │     PI logo /        │  │
│  │     brand mark       │  │
│  │                      │  │
│  └──────────────────────┘  │
│         padding             │
└────────────────────────────┘
```

The maskable icon will be the existing icon centered with 20% transparent padding on each edge (shrinking the artwork to 60% of the canvas). This ensures the logo is fully visible inside Android's adaptive icon mask.

## iOS Safari PWA Requirements

iOS Safari does not use `beforeinstallprompt`. "Add to Home Screen" is always a manual action (Share → Add to Home Screen). Safari uses proprietary Apple meta tags to configure the standalone experience.

### Currently satisfied
| Requirement | Status | Evidence |
|---|---|---|
| `apple-mobile-web-app-capable` | ✅ | Present in `index.html` |
| `apple-touch-icon` (generic) | ⚠️ | 192×192 only — iPhone expects 180×180 |

### Currently missing (this change)
| Requirement | Status | Fix |
|---|---|---|
| `apple-mobile-web-app-title` | ❌ | Add `<meta>` with app name |
| `apple-mobile-web-app-status-bar-style` | ❌ | Add `<meta content="black-translucent">` for full-bleed dark theme |
| `viewport-fit=cover` | ❌ | Update viewport meta for notched iPhones (X, 11, 12, 13, 14, 15, 16) |
| `apple-touch-icon` at 180×180 | ❌ | Add dedicated iPhone icon size |
| Splash screen (`apple-touch-startup-image`) | ❌ | Add `<link>` for standalone launch screen |

### Out of scope
| Issue | Rationale |
|---|---|
| `apple-touch-icon-precomposed` | Deprecated by Apple — `apple-touch-icon` is sufficient on iOS 7+ |
| Multiple splash screen sizes | Dashboard is used landscape on desktop/tablet; one 1280×720 splash covers common use. Full multi-size splash matrix is disproportionate for a local-server dashboard. |
| iOS `beforeinstallprompt` equivalent | iOS does not support programmatic install prompts. The `useInstallPrompt` hook already detects iOS and shows a banner with instructions to use Share → Add to Home Screen. |

**Note**: Unlike Android Chrome, iOS Safari does NOT require HTTPS for "Add to Home Screen". All iOS changes in this proposal work over plain HTTP on LAN.

### iOS meta tag design

```html
<!-- iOS standalone mode config -->
<meta name="apple-mobile-web-app-title" content="PI Dashboard" />
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />

<!-- Notched iPhone full-bleed (iPhone X+) -->
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />

<!-- iPhone-optimized home screen icon -->
<link rel="apple-touch-icon" sizes="180x180" href="/icon-180.png" />

<!-- Splash screen for cold launch in standalone mode -->
<link rel="apple-touch-startup-image" href="/splash-1280x720.png" />
```

Key decisions:

1. **`black-translucent` status bar** — Matches the existing `background_color: #0f172a` (dark). The status bar blends into the app background, giving a native-feeling full-bleed top edge. Less jarring than `black` (solid black bar above a dark-blue app).

2. **`viewport-fit=cover`** — On notched iPhones, `safe-area-inset-*` CSS env variables become usable. Without this, the viewport is inset from the notch/home indicator, wasting screen real estate. The dashboard already uses Tailwind + a responsive sidebar layout that benefits from full-width.

3. **Single splash screen** — A 1280×720 PNG covers the most common dashboard usage (landscape, desktop/tablet). iOS falls back gracefully if the image doesn't match the device resolution. A full matrix of device-specific splash images is heavyweight for a local-server tool.

## Service worker `clients.claim()`

Without `clients.claim()`, the service worker only controls pages loaded *after* registration. On first visit → install → open, the installed PWA opens a new page that the SW doesn't control yet because the SW activates asynchronously. `clients.claim()` in the `activate` event makes the SW take immediate control of all open pages.

This matters for both Android (Chrome requires an active SW for the install prompt to reappear if dismissed) and iOS (standalone-mode pages should be SW-controlled for consistent behavior).

This is safe because the SW is pass-through only (no caching). There's no stale cache risk.
