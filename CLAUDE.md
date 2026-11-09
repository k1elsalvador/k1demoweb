# K1 Demo Kiosk web UI

This repo is the **web page** shown by the K1 Demo Kiosk Android app: a full-screen kiosk UI that
drives the real K1 coin acceptor, bill acceptor and QR reader, plus the tablet camera, and fakes
everything else (no backend, no wallet, nothing is really sent). It is **demo-only**, never
production. It's plain static files published with GitHub Pages; there's no build step.

- `kiosk.js`: the page's **only** connection to the hardware. Don't modify it here; its source
  of truth is the K1DemoKiosk app repo (`web/kiosk.js`), and it must match the app's protocol.
- `kiosk.css`: styles for kiosk.js's mock panel. Keep it linked.
- `index.html`, `demo.js`, `styles.css`: the current example demo (Buy: cash → wallet QR → fake
  send; Withdraw: amount → voucher QR → "take your cash"). Reuse, change or replace freely.

## The hardware

The kiosk is an Amazon Fire HD 8 tablet (portrait, 800×1280, touch only, no keyboard) on top of
a K1 board with a coin acceptor, a bill acceptor, a QR reader and a bill dispenser. The page runs
inside an Android WebView, full-screen.

## Using kiosk.js

Load it with plain tags, before your own code:

```html
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<link rel="stylesheet" href="kiosk.css">
<script src="kiosk.js"></script>
<script src="your-app.js"></script>
```

The `viewport` line is required: the app places the camera picture using CSS px × screen density.

```js
const info = await kiosk.ready;          // { mode: 'device' | 'mock', host, version }

kiosk.on('cash',   e => …);  // { kind: 'coin'|'bill', pulses, amount (dollars) | null, nonce }
kiosk.on('qr',     e => …);  // { text, source: 'k1'|'camera'|'mock' }
kiosk.on('status', s => …);  // { usb, k1Alive, coins, bills, k1qr, camera }
kiosk.on('camera', e => …);  // { state: 'started'|'stopped'|'error', message? }
kiosk.on('reset',  e => …);  // app was paused: go back to the start screen
// kiosk.on() returns an unsubscribe function; kiosk.off(type, fn) also works.

await kiosk.coins.enable(true);   // false to turn off
await kiosk.bills.enable(true);
await kiosk.k1qr.enable(true);    // the K1's own QR reader
await kiosk.camera.start(element, { facing: 'front' });   // tablet camera QR scanning
await kiosk.camera.stop();
await kiosk.allOff();             // acceptors, K1 QR and camera all off

kiosk.setDenominations({ coin: { 1: 1.00, 2: 0.25, 3: 0.10, 4: 0.05 }, bill: { 1: 20, 2: 10, 3: 5, 4: 1 } });
kiosk.state();                    // last known status
```

Commands resolve to `{ status }`: `success` / `ok` mean done; `not_initialized` means no K1 on
USB; `io_error` or `timeout` mean it failed. Show a friendly error rather than hanging.

## Rules (the page won't work on the kiosk otherwise)

1. **Never use browser hardware APIs.** No `getUserMedia`, `BarcodeDetector`, WebUSB/WebSerial or
   QR libraries reading the camera. The Fire tablets have no Google Play services, and the app
   owns the camera and USB. Everything goes through `kiosk`.
2. **The camera picture is native and drawn *on top of* the page**, exactly over the element you
   pass to `kiosk.camera.start()`. So:
   - give that element a fixed, non-zero size and make it visible before starting (start it after
     layout, e.g. in `requestAnimationFrame`);
   - put nothing over it (text, buttons, dialogs): it will be hidden. Labels go outside the box;
   - the page must not scroll while the camera is on (the box position is re-sent on resize, not
     on scroll);
   - the picture is a plain rectangle (rounded corners on the element don't clip it);
   - call `kiosk.camera.stop()` when leaving the screen, and before showing any popup.
3. **Turn devices on only on the screen that needs them, and off when leaving it.** An acceptor
   left on keeps taking real money. Cash inserted while an acceptor is off is ignored (the
   acceptor normally won't accept it).
4. **Handle `reset`**: go back to the start screen and clear any session. The app turns all the
   hardware off on every page load and whenever it's paused.
5. **Count money from `cash` events** (`e.amount`). Treat `amount === null` as an unrecognized
   coin/bill (show it, don't add it). Don't trust any other source for amounts.
6. **There is no bill dispenser API.** For withdrawals, show "Please take your cash" with the
   number of bills; a person behind the kiosk presses the dispenser's button once per bill. Give
   the user a "Done / I have my cash" button.
7. **Kiosk UX**: big touch targets (≥ 64px), no hover, no text selection, no browser dialogs
   (`alert`/`confirm`/`prompt` don't show in the app), no keyboard input except where unavoidable.
   Add an idle timeout back to the start screen (the demo uses 90s). Keep it bilingual EN/ES if
   possible.
8. **Keep everything self-contained.** Relative paths only (the site lives under
   `/<repo-name>/`, not `/`). CDN scripts are OK but the kiosk may be on a slow or restricted
   network; the app's offline fallback is the copy bundled in the APK.
9. **Show the user's text safely**: put QR contents and other input on the page with
   `textContent`, never `innerHTML`.

## Developing without the kiosk

Open the page in any browser (e.g. serve the folder with any static server, or use the GitHub
Pages URL). kiosk.js sees it's not inside the app and switches to **mock mode**: a panel at the
bottom right with "+$1 coin", "+$20 bill", … and a "Scan QR" box. Its buttons only work while the
matching device is on, like the real hardware. Press `` ` `` to hide it. From code:
`kiosk.mock.insert('bill', 1)`, `kiosk.mock.scan('text')`. `kiosk.mode` is `'mock'` there, so the
page can show a "DEMO" note.

## Where it runs

- The app only gives the hardware to pages on `https://k1elsalvador.github.io` (any repo under
  it), to the copy bundled in the app, or to a URL the operator types in the app's settings
  (Back button on the tablet → settings). Anywhere else, kiosk.js runs in mock mode.
- Debug the page on the real tablet with Chrome on a laptop: `chrome://inspect` (USB debugging).
- Publish: push to `main`; GitHub Pages serves the repo root.
