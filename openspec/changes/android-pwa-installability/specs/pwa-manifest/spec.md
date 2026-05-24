## MODIFIED Requirements

### Requirement: Manifest `id` field
The manifest SHALL include an `id` field set to `"/"` so Chrome 120+ on Android can resolve the PWA identity.

#### Scenario: Manifest includes id
- **WHEN** a browser requests `/manifest.json`
- **THEN** the response SHALL contain `"id": "/"`

### Requirement: Manifest `scope` field
The manifest SHALL include a `scope` field set to `"/"` to explicitly define the navigation scope.

#### Scenario: Manifest includes scope
- **WHEN** a browser requests `/manifest.json`
- **THEN** the response SHALL contain `"scope": "/"`

### Requirement: Manifest `description` field
The manifest SHALL include a `description` field summarizing the app for the Android install dialog.

#### Scenario: Manifest includes description
- **WHEN** a browser requests `/manifest.json`
- **THEN** the response SHALL contain a `"description"` string

### Requirement: Manifest `categories` field
The manifest SHALL include a `categories` array for Android app categorization.

#### Scenario: Manifest includes categories
- **WHEN** a browser requests `/manifest.json`
- **THEN** the response SHALL contain a `"categories"` array with at least one entry

### Requirement: Manifest `display_override` field
The manifest SHALL include a `display_override` array with `"standalone"` and `"window-controls-overlay"` for modern PWA features.

#### Scenario: Manifest includes display_override
- **WHEN** a browser requests `/manifest.json`
- **THEN** the response SHALL contain a `"display_override"` array

### Requirement: Manifest `screenshots` array
The manifest SHALL include a `screenshots` array with at least one entry so Chrome on Android shows the install prompt.

#### Scenario: Manifest includes screenshots
- **WHEN** a browser requests `/manifest.json`
- **THEN** the response SHALL contain a `"screenshots"` array with at least one entry having `src`, `sizes`, and `type` fields

#### Scenario: Screenshot image is served
- **WHEN** a browser requests a screenshot URL listed in the manifest
- **THEN** the server SHALL return a valid PNG image

## ADDED Requirements

### Requirement: Maskable icon variants
The manifest SHALL include dedicated maskable icon entries with `"purpose": "maskable"` pointing to icons that have ≥40% safe zone padding for Android adaptive icons.

#### Scenario: Manifest includes maskable icon entries
- **WHEN** a browser requests `/manifest.json`
- **THEN** the response SHALL contain icon entries with `"purpose": "maskable"` at 180×180, 192×192, and 512×512 sizes

#### Scenario: Maskable icon files exist
- **WHEN** a browser requests a maskable icon URL
- **THEN** the server SHALL return a valid PNG image with sufficient safe zone padding

### Requirement: iOS standalone meta tags
The `index.html` SHALL include iOS-specific meta tags to configure the standalone web app experience: `apple-mobile-web-app-title`, `apple-mobile-web-app-status-bar-style`, and `viewport-fit=cover`.

#### Scenario: iOS title meta tag present
- **WHEN** `index.html` is loaded
- **THEN** it SHALL contain `<meta name="apple-mobile-web-app-title" content="PI Dashboard">`

#### Scenario: iOS status bar style present
- **WHEN** `index.html` is loaded
- **THEN** it SHALL contain `<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">`

#### Scenario: Viewport includes safe-area support
- **WHEN** `index.html` is loaded
- **THEN** the viewport meta tag SHALL include `viewport-fit=cover` for notched iPhone full-bleed

### Requirement: iPhone-optimized touch icon
The `index.html` SHALL include an `apple-touch-icon` link at 180×180 pixels for iPhone home screen icons.

#### Scenario: iPhone touch icon present
- **WHEN** `index.html` is loaded
- **THEN** it SHALL contain `<link rel="apple-touch-icon" sizes="180x180" href="/icon-180.png">`

#### Scenario: iPhone icon file served
- **WHEN** a browser requests `/icon-180.png`
- **THEN** the server SHALL return a valid 180×180 PNG image

### Requirement: iOS splash screen
The `index.html` SHALL include an `apple-touch-startup-image` link so the standalone app shows a branded splash screen on cold launch instead of a white flash.

#### Scenario: Splash screen link present
- **WHEN** `index.html` is loaded
- **THEN** it SHALL contain `<link rel="apple-touch-startup-image" href="/splash-1280x720.png">`

#### Scenario: Splash screen image served
- **WHEN** a browser requests `/splash-1280x720.png`
- **THEN** the server SHALL return a valid 1280×720 PNG image

### Requirement: Service worker `activate` with `clients.claim`
The service worker SHALL include an `activate` event handler that calls `clients.claim()` so the service worker takes control of all pages immediately on first install, without requiring a navigation.

#### Scenario: Service worker claims clients on activate
- **WHEN** the service worker activates for the first time
- **THEN** it SHALL call `self.clients.claim()` to take control of open pages
