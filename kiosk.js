/*
 * kiosk.js — the demo page's only way to reach the K1 hardware.
 *
 * Inside the K1 Demo Kiosk Android app it talks to the real coin/bill acceptors, the K1 QR reader
 * and the tablet camera. In any other browser it switches to a mock with an on-screen control
 * panel, so demos can be built and rehearsed on a laptop.
 *
 *   await kiosk.ready                       // { mode: 'device' | 'mock', host, version }
 *   kiosk.on('cash',   e => ...)            // { kind: 'coin'|'bill', pulses, amount|null, nonce }
 *   kiosk.on('qr',     e => ...)            // { text, source: 'k1'|'camera'|'mock' }
 *   kiosk.on('status', s => ...)            // { usb, k1Alive, coins, bills, k1qr, camera }
 *   kiosk.on('camera', e => ...)            // { state: 'started'|'stopped'|'error', message? }
 *   kiosk.on('reset',  e => ...)            // the host paused/left the page — go back to start
 *   kiosk.coins.enable(true)  kiosk.bills.enable(true)  kiosk.k1qr.enable(true)
 *   kiosk.camera.start(element, { facing: 'front'|'back' })   kiosk.camera.stop()
 *   kiosk.allOff()
 *   kiosk.setDenominations({ coin: { 1: 1.00, ... }, bill: { 1: 20, ... } })
 *
 * The host <-> page wire protocol is documented in CLAUDE.md ("Bridge protocol").
 */
(function () {
  'use strict';

  // Production defaults (MiniPlusApp DeviceConfigDto): K1 pulse count -> value.
  const DEFAULT_DENOMINATIONS = {
    coin: { 1: 1.0, 2: 0.25, 3: 0.1, 4: 0.05 },
    bill: { 1: 20, 2: 10, 3: 5, 4: 1 },
  };
  const COMMAND_TIMEOUT_MS = 3000;

  const listeners = {};
  const pending = new Map();
  let nextId = 1;
  let denominations = JSON.parse(JSON.stringify(DEFAULT_DENOMINATIONS));
  const state = { usb: false, k1Alive: false, coins: false, bills: false, k1qr: false, camera: false };

  function emit(type, data) {
    for (const fn of (listeners[type] || []).concat(listeners['*'] || [])) {
      try { fn(data, type); } catch (e) { console.error('kiosk listener failed', e); }
    }
  }

  function handleEvent(ev) {
    if (!ev || typeof ev.type !== 'string') return;
    switch (ev.type) {
      case 'result': {
        const p = pending.get(ev.id);
        if (p) { pending.delete(ev.id); clearTimeout(p.timer); p.resolve(ev); }
        return;
      }
      case 'status':
        Object.assign(state, {
          usb: !!ev.usb, k1Alive: !!ev.k1Alive, coins: !!ev.coins, bills: !!ev.bills, k1qr: !!ev.k1qr,
        });
        emit('status', Object.assign({}, state));
        return;
      case 'cash': {
        const table = denominations[ev.kind] || {};
        const amount = Object.prototype.hasOwnProperty.call(table, ev.pulses) ? Number(table[ev.pulses]) : null;
        emit('cash', { kind: ev.kind, pulses: ev.pulses, amount, nonce: ev.nonce });
        return;
      }
      case 'camera':
        state.camera = ev.state === 'started';
        emit('camera', ev);
        emit('status', Object.assign({}, state));
        return;
      default:
        emit(ev.type, ev);
    }
  }

  // ---- transports -------------------------------------------------------------------------

  function deviceTransport() {
    const host = window.K1KioskHost; // injected by WebViewCompat.addWebMessageListener
    if (host && typeof host.postMessage === 'function') {
      host.addEventListener('message', e => {
        try { handleEvent(JSON.parse(e.data)); } catch (err) { console.error('bad host message', err); }
      });
      return { send: obj => host.postMessage(JSON.stringify(obj)) };
    }
    const legacy = window.K1KioskHostLegacy; // older WebViews: @JavascriptInterface fallback
    if (legacy && typeof legacy.postMessage === 'function') {
      window.__k1KioskDispatch = str => {
        try { handleEvent(JSON.parse(str)); } catch (err) { console.error('bad host message', err); }
      };
      return { send: obj => legacy.postMessage(JSON.stringify(obj)) };
    }
    return null;
  }

  function command(cmd, params) {
    const id = nextId++;
    const msg = Object.assign({ id, cmd }, params || {});
    return new Promise(resolve => {
      const timer = setTimeout(() => { pending.delete(id); resolve({ status: 'timeout', cmd }); }, COMMAND_TIMEOUT_MS);
      pending.set(id, { resolve, timer });
      transport.send(msg);
    });
  }

  // ---- mock (any browser outside the Android host) ----------------------------------------

  function mockTransport() {
    const mock = { state: { coins: false, bills: false, k1qr: false, camera: false }, cameraBox: null, panel: null };

    function push(ev) { setTimeout(() => handleEvent(ev), 0); }
    function pushStatus() {
      push({ type: 'status', usb: true, k1Alive: true, coins: mock.state.coins, bills: mock.state.bills, k1qr: mock.state.k1qr });
      renderPanel();
    }

    function placeCameraBox(rect) {
      if (!mock.cameraBox) {
        mock.cameraBox = document.createElement('div');
        mock.cameraBox.className = 'k1-mock-camera';
        mock.cameraBox.textContent = 'Camera (mock) — use "Scan QR" in the mock panel';
        document.body.appendChild(mock.cameraBox);
      }
      Object.assign(mock.cameraBox.style, {
        left: rect.x + 'px', top: rect.y + 'px', width: rect.width + 'px', height: rect.height + 'px', display: 'flex',
      });
    }

    const send = msg => {
      const ok = status => push({ type: 'result', id: msg.id, cmd: msg.cmd, status });
      switch (msg.cmd) {
        case 'hello':
          push({ type: 'result', id: msg.id, cmd: 'hello', status: 'ok', data: { host: 'mock', version: '-', channel: 'mock' } });
          pushStatus();
          return;
        case 'coins': mock.state.coins = !!msg.on; break;
        case 'bills': mock.state.bills = !!msg.on; break;
        case 'k1qr': mock.state.k1qr = !!msg.on; break;
        case 'allOff':
          mock.state.coins = mock.state.bills = mock.state.k1qr = false;
          stopCamera();
          break;
        case 'camera':
          if (msg.on) {
            mock.state.camera = true;
            if (msg.rect) placeCameraBox(msg.rect);
            push({ type: 'camera', state: 'started' });
          } else {
            stopCamera();
          }
          break;
        case 'cameraRect':
          if (mock.state.camera && msg.rect) placeCameraBox(msg.rect);
          break;
        default:
          ok('unknown_command');
          return;
      }
      ok('ok');
      pushStatus();
    };

    function stopCamera() {
      if (!mock.state.camera) return;
      mock.state.camera = false;
      if (mock.cameraBox) mock.cameraBox.style.display = 'none';
      push({ type: 'camera', state: 'stopped' });
    }

    function insert(kind, pulses) {
      if (!(kind === 'coin' ? mock.state.coins : mock.state.bills)) {
        console.warn('[kiosk mock] ' + kind + ' acceptor is off — the real hardware would ignore this');
        flash('The ' + kind + ' acceptor is off');
        return;
      }
      push({ type: 'cash', kind, pulses, nonce: Date.now() });
    }

    function scan(text) {
      const source = mock.state.camera ? 'camera' : mock.state.k1qr ? 'k1' : null;
      if (!source) { flash('No QR reader is on'); return; }
      push({ type: 'qr', source, text });
    }

    function flash(text) {
      const el = document.createElement('div');
      el.className = 'k1-mock-flash';
      el.textContent = text;
      document.body.appendChild(el);
      setTimeout(() => el.remove(), 1500);
    }

    function renderPanel() {
      if (!document.body) return;
      if (!mock.panel) {
        mock.panel = document.createElement('div');
        mock.panel.className = 'k1-mock-panel';
        document.body.appendChild(mock.panel);
      }
      const p = mock.panel;
      p.textContent = '';
      const title = document.createElement('div');
      title.className = 'k1-mock-title';
      title.textContent = 'K1 mock — press ` to hide';
      p.appendChild(title);
      for (const kind of ['coin', 'bill']) {
        const row = document.createElement('div');
        row.className = 'k1-mock-row';
        const on = kind === 'coin' ? mock.state.coins : mock.state.bills;
        for (const [pulses, value] of Object.entries(denominations[kind])) {
          const b = document.createElement('button');
          b.textContent = '+' + Number(value).toFixed(value < 1 ? 2 : 0) + ' ' + kind;
          b.disabled = !on;
          b.onclick = () => insert(kind, Number(pulses));
          row.appendChild(b);
        }
        p.appendChild(row);
      }
      const qrRow = document.createElement('div');
      qrRow.className = 'k1-mock-row';
      const input = document.createElement('input');
      input.placeholder = 'QR text';
      input.value = 'bc1qdemo0wallet0address0k1demo0kiosk0xyz';
      const scanBtn = document.createElement('button');
      scanBtn.textContent = 'Scan QR';
      scanBtn.disabled = !(mock.state.camera || mock.state.k1qr);
      scanBtn.onclick = () => scan(input.value);
      qrRow.append(input, scanBtn);
      p.appendChild(qrRow);
    }

    document.addEventListener('keydown', e => {
      if (e.key === '`' && mock.panel) mock.panel.hidden = !mock.panel.hidden;
    });
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', renderPanel);
    else renderPanel();

    window.addEventListener('k1-denominations-changed', renderPanel);
    return { send, mock: { insert, scan } };
  }

  // ---- public API -------------------------------------------------------------------------

  let transport = deviceTransport();
  const mode = transport ? 'device' : 'mock';
  let mockControls = null;
  if (!transport) {
    const m = mockTransport();
    transport = m;
    mockControls = m.mock;
  }

  let cameraEl = null;
  let cameraObserver = null;
  function cameraRect(el) {
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, width: r.width, height: r.height };
  }
  function sendCameraRect() {
    if (cameraEl) transport.send({ cmd: 'cameraRect', rect: cameraRect(cameraEl) });
  }

  const ready = command('hello').then(res => Object.assign({ mode }, res.data || {}));

  window.kiosk = {
    mode,
    ready,
    on(type, fn) { (listeners[type] = listeners[type] || []).push(fn); return () => this.off(type, fn); },
    off(type, fn) { listeners[type] = (listeners[type] || []).filter(f => f !== fn); },
    coins: { enable: on => command('coins', { on: !!on }) },
    bills: { enable: on => command('bills', { on: !!on }) },
    k1qr: { enable: on => command('k1qr', { on: !!on }) },
    camera: {
      // The camera picture is drawn by the host over the page, exactly on top of `element`.
      start(element, opts) {
        cameraEl = element;
        if (window.ResizeObserver) {
          cameraObserver = new ResizeObserver(sendCameraRect);
          cameraObserver.observe(element);
        }
        window.addEventListener('resize', sendCameraRect);
        return command('camera', { on: true, rect: cameraRect(element), facing: (opts && opts.facing) || 'front' });
      },
      stop() {
        if (cameraObserver) cameraObserver.disconnect();
        cameraObserver = null;
        window.removeEventListener('resize', sendCameraRect);
        cameraEl = null;
        return command('camera', { on: false });
      },
    },
    allOff() {
      if (cameraObserver) cameraObserver.disconnect();
      cameraObserver = null;
      cameraEl = null;
      return command('allOff');
    },
    setDenominations(table) {
      denominations = {
        coin: Object.assign({}, (table && table.coin) || DEFAULT_DENOMINATIONS.coin),
        bill: Object.assign({}, (table && table.bill) || DEFAULT_DENOMINATIONS.bill),
      };
      window.dispatchEvent(new Event('k1-denominations-changed'));
    },
    denominations: () => JSON.parse(JSON.stringify(denominations)),
    state: () => Object.assign({}, state),
    // Only in mock mode: drive the fake hardware from code, e.g. kiosk.mock.insert('bill', 1).
    mock: mockControls,
  };
})();
