## 1. Update `manifest.json` with Android-required fields

- [ ] 1.1 Add `"id": "/"` to manifest
- [ ] 1.2 Add `"scope": "/"` to manifest
- [ ] 1.3 Add `"description": "Monitor and interact with pi agent sessions"` to manifest
- [ ] 1.4 Add `"categories": ["productivity", "utilities"]` to manifest
- [ ] 1.5 Add `"display_override": ["standalone", "window-controls-overlay"]` to manifest
- [ ] 1.6 Verify manifest parses as valid JSON: `cat public/manifest.json | python3 -m json.tool > /dev/null`

## 2. Add maskable icon variants (Android)

- [ ] 2.1 Generate `public/icon-192-maskable.png` — center existing icon with 20% transparent padding on each side (safe zone padding for Android adaptive icons). Use ImageMagick or sharp.
- [ ] 2.2 Generate `public/icon-512-maskable.png` — same treatment at 512×512
- [ ] 2.3 Generate `public/icon-180-maskable.png` — same treatment at 180×180
- [ ] 2.4 Add maskable icon entries to `manifest.json` icons array (192, 512, 180)
- [ ] 2.5 Verify maskable icons meet [W3C safe zone guidelines](https://www.w3.org/TR/appmanifest/#icon-maskable) (≥40% padding, artwork fully inside safe zone)

## 3. Add screenshot for Android install dialog

- [ ] 3.1 Capture a representative 1280×720 screenshot of the dashboard (desktop view with session list + chat). Save as `public/screenshot-wide.png`.
- [ ] 3.2 Add `screenshots` array to `manifest.json`
- [ ] 3.3 Verify the screenshot is served correctly: `curl -I http://localhost:8000/screenshot-wide.png` returns 200 with `image/png`

## 4. Add iOS-specific meta tags to `index.html`

- [ ] 4.1 Add `<meta name="apple-mobile-web-app-title" content="PI Dashboard">` — home screen name for iOS
- [ ] 4.2 Add `<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">` — full-bleed dark status bar in standalone mode
- [ ] 4.3 Update viewport meta to add `viewport-fit=cover` for notched iPhones:
  ```html
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
  ```
- [ ] 4.4 Add `<link rel="apple-touch-icon" sizes="180x180" href="/icon-180.png">` — iPhone-optimized home screen icon
- [ ] 4.5 Add `<link rel="apple-touch-startup-image" href="/splash-1280x720.png">` — splash screen for standalone cold launch

## 5. Create iOS splash screen image

- [ ] 5.1 Generate `public/splash-1280x720.png` — a launch image for the standalone app. Use a solid `#0f172a` background with the PI logo centered.

## 6. Create 180×180 iPhone icon

- [ ] 6.1 Generate `public/icon-180.png` — resize the base icon to 180×180 (same full-bleed style as icon-192, not padded)

## 7. Update `sw.js` with `activate` handler

- [ ] 7.1 Add `activate` event listener calling `self.clients.claim()`:
  ```js
  self.addEventListener("activate", (event) => {
    event.waitUntil(self.clients.claim());
  });
  ```
- [ ] 7.2 Verify `sw.js` remains valid JavaScript (no syntax errors)

## 8. Update `index.html` manifest link

- [ ] 8.1 Add `crossorigin="use-credentials"` to the `<link rel="manifest">` tag (Chrome Android sometimes needs this for manifest fetches through authenticated proxies)

## 9. Update OpenSpec spec

- [ ] 9.1 Apply delta spec from `openspec/changes/android-pwa-installability/specs/pwa-manifest/spec.md` to `openspec/specs/pwa-manifest/spec.md` (add new requirements for `id`, `screenshots`, maskable icons, iOS meta tags, `clients.claim()`)

## 10. Test Android PWA installability (over HTTPS)

Android Chrome requires HTTPS for PWA install (only `localhost`/`127.0.0.1` exempt). Direct LAN HTTP (`http://192.168.x.x`) will NOT work.

- [ ] 10.1 Option A — localhost via ADB port forwarding: `adb reverse tcp:8000 tcp:8000`, then open `http://localhost:8000` on Android Chrome. Verify install prompt appears.
- [ ] 10.2 Option B — tunnel (if zrok is set up): start dashboard with `tunnel.enabled: true`, open HTTPS tunnel URL on Android Chrome. Verify install prompt appears.
- [ ] 10.3 Complete install from whichever option was used. Verify:
  - App icon appears on home screen with proper masking (no cropped edges)
  - App launches in standalone mode (no browser chrome)
  - App identity persists across cold starts (Chrome doesn't show a second install prompt)
- [ ] 10.4 Verify service worker activates immediately: Chrome DevTools (remote debugging) → Application → Service Workers — status is "activated and is running"

## 11. Test iOS PWA installability (works over LAN HTTP)

iOS Safari does NOT require HTTPS for "Add to Home Screen". Direct LAN access works.

- [ ] 11.1 Open `http://<lan-ip>:8000` on iOS Safari. Verify:
  - Share sheet → "Add to Home Screen" is available
  - Dialog shows correct name ("PI Dashboard") and icon
- [ ] 11.2 Add to Home Screen. Verify:
  - App icon appears on home screen without letterboxing
  - App launches in standalone mode (no Safari toolbar, no URL bar)
  - Status bar blends into app background (black-translucent, not solid black bar)
- [ ] 11.3 On notched iPhone (X or later), verify:
  - App content extends behind the notch and home indicator (full-bleed)
  - No white bars at top or bottom in landscape
- [ ] 11.4 Cold launch: force-quit the app, reopen from home screen. Verify:
  - Splash screen appears briefly (instead of white flash) during load
  - App loads in standalone mode (doesn't fall back to Safari)

## 12. Regression: verify desktop PWA still works

- [ ] 12.1 Open dashboard on desktop Chrome. Verify `beforeinstallprompt` still fires.
- [ ] 12.2 If previously installed on desktop, verify the existing PWA is not orphaned by the `id` change (`id: "/"` matches previous implicit identity derived from `start_url`).
- [ ] 12.3 Verify manifest validates: Chrome DevTools → Application → Manifest — no errors or warnings.
