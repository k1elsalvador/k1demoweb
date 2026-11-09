/*
 * The demo kiosk flows. Everything after the hardware is pretend: there is no backend, the
 * "server" is a timer, and nothing is ever really sent. The hardware parts are real when running
 * inside the K1 Demo Kiosk app (see kiosk.js).
 *
 *   Buy:      insert cash -> scan wallet QR -> confirm -> "sending" -> sent
 *   Withdraw: pick amount -> scan voucher QR -> "checking" -> take your cash
 *             (the operator presses the dispenser's back button once per bill)
 */
(function () {
  'use strict';

  const CONFIG = {
    currency: 'USD',
    maxDeposit: 250,
    feePercent: 3,
    btcPriceUsd: 100000,                 // demo rate, not live
    withdrawAmounts: [20, 40, 60, 100],
    withdrawBill: 20,                    // the dispenser holds one denomination
    idleResetMs: 90000,
    successResetMs: 20000,
    demoWallet: 'bc1qdemo0wallet0address0k1demo0kiosk0xyz',
  };

  // ---- i18n -------------------------------------------------------------------------------
  const STRINGS = {
    en: {
      welcome: 'Welcome', welcomeSub: 'Touch an option to start',
      buy: 'Buy bitcoin', buySub: 'Pay with coins and bills',
      withdraw: 'Withdraw cash', withdrawSub: 'Get cash for a voucher',
      insertTitle: 'Insert your coins and bills', insertSub: 'Up to {max}',
      coinsOn: 'Coins', billsOn: 'Bills', continue: 'Continue', cancel: 'Cancel',
      maxReached: 'Maximum amount reached',
      scanWalletTitle: 'Scan your wallet QR', scanWalletSub: 'Hold your phone in front of the camera',
      useDemoWallet: 'Use demo wallet', back: 'Back',
      confirmTitle: 'Confirm your purchase', deposited: 'Cash inserted', fee: 'Fee ({p}%)',
      youGet: 'You receive', rate: 'Demo rate', to: 'To', send: 'Send bitcoin',
      sending: 'Sending your bitcoin…', stepServer: 'Contacting server', stepPrice: 'Locking price', stepSend: 'Sending payment',
      sentTitle: 'Bitcoin sent!', sentSub: 'Payment ID {id}', done: 'Done',
      withdrawTitle: 'How much cash?', withdrawSubBills: 'Paid in {bill} bills',
      scanVoucherTitle: 'Scan your voucher QR', scanVoucherSub: 'Show the voucher to the camera',
      useDemoVoucher: 'Use demo voucher',
      checking: 'Checking your voucher…', stepVoucher: 'Verifying voucher', stepPayout: 'Preparing cash',
      takeCashTitle: 'Please take your cash', takeCashSub: '{n} × {bill} bills from the dispenser below',
      cashTaken: 'I have my cash',
      footer: 'Demonstration only — no real bitcoin is sent and no real voucher is redeemed.',
      footerMock: 'Browser mock mode — the cash devices are simulated (panel at bottom right).',
      cancelledWithCash: 'Demo cancelled. In a real kiosk the inserted cash would be refunded or credited.',
    },
    es: {
      welcome: 'Bienvenido', welcomeSub: 'Toque una opción para empezar',
      buy: 'Comprar bitcoin', buySub: 'Pague con monedas y billetes',
      withdraw: 'Retirar efectivo', withdrawSub: 'Reciba efectivo por un voucher',
      insertTitle: 'Inserte sus monedas y billetes', insertSub: 'Hasta {max}',
      coinsOn: 'Monedas', billsOn: 'Billetes', continue: 'Continuar', cancel: 'Cancelar',
      maxReached: 'Monto máximo alcanzado',
      scanWalletTitle: 'Escanee el QR de su billetera', scanWalletSub: 'Acerque su teléfono a la cámara',
      useDemoWallet: 'Usar billetera demo', back: 'Atrás',
      confirmTitle: 'Confirme su compra', deposited: 'Efectivo insertado', fee: 'Comisión ({p}%)',
      youGet: 'Usted recibe', rate: 'Tasa demo', to: 'Para', send: 'Enviar bitcoin',
      sending: 'Enviando su bitcoin…', stepServer: 'Contactando al servidor', stepPrice: 'Fijando precio', stepSend: 'Enviando pago',
      sentTitle: '¡Bitcoin enviado!', sentSub: 'ID de pago {id}', done: 'Listo',
      withdrawTitle: '¿Cuánto efectivo?', withdrawSubBills: 'En billetes de {bill}',
      scanVoucherTitle: 'Escanee el QR de su voucher', scanVoucherSub: 'Muestre el voucher a la cámara',
      useDemoVoucher: 'Usar voucher demo',
      checking: 'Verificando su voucher…', stepVoucher: 'Validando voucher', stepPayout: 'Preparando efectivo',
      takeCashTitle: 'Por favor tome su efectivo', takeCashSub: '{n} × billetes de {bill} del dispensador',
      cashTaken: 'Ya tengo mi efectivo',
      footer: 'Solo demostración — no se envía bitcoin real ni se canjea ningún voucher.',
      footerMock: 'Modo simulado en navegador — los dispositivos de efectivo son simulados (panel abajo a la derecha).',
      cancelledWithCash: 'Demo cancelada. En un kiosco real el efectivo insertado se devolvería o acreditaría.',
    },
  };
  let lang = 'en';
  function t(key, vars) {
    let s = (STRINGS[lang] && STRINGS[lang][key]) || STRINGS.en[key] || key;
    for (const [k, v] of Object.entries(vars || {})) s = s.replace('{' + k + '}', v);
    return s;
  }

  // ---- helpers ----------------------------------------------------------------------------
  // All dynamic text goes through textContent, never innerHTML (QR contents are untrusted).
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, '');
      else if (v !== false && v != null) el.setAttribute(k, v);
    }
    for (const c of children.flat()) {
      if (c == null || c === false) continue;
      el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    }
    return el;
  }
  const money = n => new Intl.NumberFormat(lang === 'es' ? 'es-SV' : 'en-US', { style: 'currency', currency: CONFIG.currency }).format(n);
  const sats = n => new Intl.NumberFormat(lang === 'es' ? 'es-SV' : 'en-US').format(Math.floor(n)) + ' sats';
  const usdToSats = usd => usd / CONFIG.btcPriceUsd * 1e8;
  const shorten = s => (s.length > 26 ? s.slice(0, 12) + '…' + s.slice(-10) : s);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const fakeId = () => Array.from({ length: 4 }, () => Math.random().toString(16).slice(2, 6)).join('-').toUpperCase();

  // ---- app state & screen switching ---------------------------------------------------------
  const app = document.getElementById('app');
  let session = null;
  let current = null;      // { name, leave() }
  let idleTimer = null;
  let screenToken = 0;     // bumps on every screen change, so stale async steps stop

  function newSession() {
    return { deposited: 0, items: [], wallet: null, withdrawAmount: 0, voucher: null, paymentId: null };
  }

  function show(name, ...args) {
    if (current && current.leave) current.leave();
    screenToken++;
    app.textContent = '';
    current = { name };
    SCREENS[name](...args);
    armIdle();
  }

  function armIdle() {
    clearTimeout(idleTimer);
    if (current && current.name !== 'home') idleTimer = setTimeout(() => goHome(), CONFIG.idleResetMs);
  }
  ['pointerdown', 'keydown'].forEach(ev => document.addEventListener(ev, armIdle, { passive: true }));

  function goHome(notice) {
    kiosk.allOff();
    session = newSession();
    show('home', typeof notice === 'string' ? notice : null);
  }

  /** Turns on the camera over `box` plus the K1 reader; resolves with the first QR read. */
  function scanQr(box) {
    const token = screenToken;
    kiosk.k1qr.enable(true);
    // Wait a frame so the box has its final layout before the host positions the preview on it.
    requestAnimationFrame(() => { if (token === screenToken) kiosk.camera.start(box); });
    return new Promise(resolve => {
      const unsubscribe = kiosk.on('qr', e => {
        if (token !== screenToken) return unsubscribe();
        unsubscribe();
        resolve(e.text);
      });
      current.leave = () => { unsubscribe(); kiosk.camera.stop(); kiosk.k1qr.enable(false); };
    });
  }

  async function runSteps(list, keys) {
    const token = screenToken;
    for (const key of keys) {
      await sleep(900 + Math.random() * 700);
      if (token !== screenToken) return false;
      const li = list.querySelector('[data-step="' + key + '"]');
      if (li) li.classList.add('done');
    }
    await sleep(400);
    return token === screenToken;
  }

  // ---- screens ------------------------------------------------------------------------------
  const SCREENS = {
    home(notice) {
      app.append(
        ...(notice ? [h('p', { class: 'error' }, notice)] : []),
        h('h1', null, t('welcome')),
        h('p', { class: 'lead' }, t('welcomeSub')),
        h('div', { class: 'home-choices' },
          h('button', { class: 'choice', onclick: () => { session = newSession(); show('insert'); } },
            h('div', { class: 'icon' }, '₿'), h('div', { class: 'title' }, t('buy')), h('div', { class: 'sub' }, t('buySub'))),
          h('button', { class: 'choice', onclick: () => { session = newSession(); show('withdrawAmount'); } },
            h('div', { class: 'icon' }, '💵'), h('div', { class: 'title' }, t('withdraw')), h('div', { class: 'sub' }, t('withdrawSub'))),
        ),
      );
    },

    insert() {
      const total = h('div', { class: 'total' }, money(session.deposited));
      const satsLine = h('div', { class: 'sats' }, '≈ ' + sats(usdToSats(session.deposited)));
      const chips = h('div', { class: 'inserted' });
      const coinHint = h('span', null, '● ' + t('coinsOn'));
      const billHint = h('span', null, '▬ ' + t('billsOn'));
      const note = h('div', { class: 'error' });
      const cont = h('button', { class: 'btn', disabled: true, onclick: () => show('scanWallet') }, t('continue'));
      const cancel = h('button', {
        class: 'btn secondary',
        onclick: () => goHome(session.deposited > 0 ? t('cancelledWithCash') : null),
      }, t('cancel'));

      app.append(
        h('h2', null, t('insertTitle')),
        h('p', { class: 'lead' }, t('insertSub', { max: money(CONFIG.maxDeposit) })),
        total, satsLine, chips,
        h('div', { class: 'hint-row' }, coinHint, billHint),
        note,
        h('div', { class: 'row' }, cancel, cont),
      );

      const offCash = kiosk.on('cash', e => {
        if (e.amount == null) return; // unknown pulse count
        session.deposited = Math.round((session.deposited + e.amount) * 100) / 100;
        session.items.push(e);
        total.textContent = money(session.deposited);
        total.classList.remove('bump'); void total.offsetWidth; total.classList.add('bump');
        satsLine.textContent = '≈ ' + sats(usdToSats(session.deposited));
        chips.appendChild(h('span', { class: 'chip ' + e.kind }, money(e.amount)));
        cont.disabled = false;
        if (session.deposited >= CONFIG.maxDeposit) {
          kiosk.coins.enable(false);
          kiosk.bills.enable(false);
          note.textContent = t('maxReached');
        }
      });
      const offStatus = kiosk.on('status', s => {
        coinHint.className = s.coins ? 'on' : '';
        billHint.className = s.bills ? 'on' : '';
      });
      kiosk.coins.enable(true);
      kiosk.bills.enable(true);
      current.leave = () => { offCash(); offStatus(); kiosk.coins.enable(false); kiosk.bills.enable(false); };
    },

    scanWallet() {
      const box = h('div', { class: 'camera-box' });
      app.append(
        h('h2', null, t('scanWalletTitle')),
        h('p', { class: 'lead' }, t('scanWalletSub')),
        box,
        h('div', { class: 'row' },
          h('button', { class: 'btn secondary small', onclick: () => show('insert') }, t('back')),
          h('button', { class: 'btn secondary small', onclick: () => { session.wallet = CONFIG.demoWallet; show('confirm'); } }, t('useDemoWallet')),
        ),
      );
      scanQr(box).then(text => {
        session.wallet = text.replace(/^(bitcoin|lightning):/i, '');
        show('confirm');
      });
    },

    confirm() {
      const fee = Math.round(session.deposited * CONFIG.feePercent) / 100;
      const net = session.deposited - fee;
      app.append(
        h('h2', null, t('confirmTitle')),
        h('div', { class: 'summary' },
          h('div', { class: 'line' }, h('span', null, t('deposited')), h('span', null, money(session.deposited))),
          h('div', { class: 'line' }, h('span', null, t('fee', { p: CONFIG.feePercent })), h('span', null, '−' + money(fee))),
          h('div', { class: 'line' }, h('span', null, t('youGet')), h('strong', null, sats(usdToSats(net)))),
          h('div', { class: 'line' }, h('span', null, t('rate')), h('span', null, '1 BTC = ' + money(CONFIG.btcPriceUsd))),
          h('div', { class: 'line' }, h('span', null, t('to')), h('span', { class: 'mono' }, shorten(session.wallet))),
        ),
        h('div', { class: 'row' },
          h('button', { class: 'btn secondary', onclick: () => show('scanWallet') }, t('back')),
          h('button', { class: 'btn', onclick: () => show('sending') }, t('send')),
        ),
      );
    },

    async sending() {
      const list = h('ul', { class: 'steps' },
        h('li', { 'data-step': 'server' }, t('stepServer')),
        h('li', { 'data-step': 'price' }, t('stepPrice')),
        h('li', { 'data-step': 'send' }, t('stepSend')));
      app.append(h('div', { class: 'spinner' }), h('h2', null, t('sending')), list);
      if (await runSteps(list, ['server', 'price', 'send'])) {
        session.paymentId = fakeId();
        show('sent');
      }
    },

    sent() {
      app.append(
        h('div', { class: 'big-icon ok' }, '✓'),
        h('h1', null, t('sentTitle')),
        h('p', { class: 'lead' }, sats(usdToSats(session.deposited * (1 - CONFIG.feePercent / 100))) + ' → ' + shorten(session.wallet)),
        h('p', { class: 'lead' }, t('sentSub', { id: session.paymentId })),
        h('button', { class: 'btn', onclick: goHome }, t('done')),
      );
      const timer = setTimeout(goHome, CONFIG.successResetMs);
      current.leave = () => clearTimeout(timer);
    },

    withdrawAmount() {
      app.append(
        h('h2', null, t('withdrawTitle')),
        h('p', { class: 'lead' }, t('withdrawSubBills', { bill: money(CONFIG.withdrawBill) })),
        h('div', { class: 'row' }, CONFIG.withdrawAmounts.map(a =>
          h('button', { class: 'btn', onclick: () => { session.withdrawAmount = a; show('scanVoucher'); } }, money(a)))),
        h('button', { class: 'btn secondary small', onclick: goHome }, t('cancel')),
      );
    },

    scanVoucher() {
      const box = h('div', { class: 'camera-box' });
      app.append(
        h('h2', null, t('scanVoucherTitle')),
        h('p', { class: 'lead' }, t('scanVoucherSub') + ' — ' + money(session.withdrawAmount)),
        box,
        h('div', { class: 'row' },
          h('button', { class: 'btn secondary small', onclick: () => show('withdrawAmount') }, t('back')),
          h('button', { class: 'btn secondary small', onclick: () => { session.voucher = 'DEMO-VOUCHER'; show('checking'); } }, t('useDemoVoucher')),
        ),
      );
      scanQr(box).then(text => { session.voucher = text; show('checking'); });
    },

    async checking() {
      const list = h('ul', { class: 'steps' },
        h('li', { 'data-step': 'voucher' }, t('stepVoucher')),
        h('li', { 'data-step': 'payout' }, t('stepPayout')));
      app.append(h('div', { class: 'spinner' }), h('h2', null, t('checking')), list);
      if (await runSteps(list, ['voucher', 'payout'])) show('takeCash');
    },

    takeCash() {
      // The real dispensing happens when the operator presses the dispenser's back button,
      // once per bill — this screen just tells the customer what to expect.
      const bills = Math.ceil(session.withdrawAmount / CONFIG.withdrawBill);
      app.append(
        h('div', { class: 'cash-anim' }, '💵'),
        h('h1', null, t('takeCashTitle')),
        h('p', { class: 'lead' }, t('takeCashSub', { n: bills, bill: money(CONFIG.withdrawBill) })),
        h('button', { class: 'btn', onclick: goHome }, t('cashTaken')),
      );
    },
  };

  // ---- chrome: status dot, language, footer -------------------------------------------------
  const dot = document.getElementById('status-dot');
  kiosk.on('status', s => dot.classList.toggle('ok', s.usb && s.k1Alive));
  kiosk.on('reset', () => goHome());
  kiosk.on('camera', e => { if (e.state === 'error') console.warn('camera:', e.message); });

  function renderFooter() {
    document.getElementById('demo-footer').textContent = kiosk.mode === 'mock' ? t('footerMock') : t('footer');
  }
  const langBtn = document.getElementById('lang-toggle');
  langBtn.addEventListener('click', () => {
    lang = lang === 'en' ? 'es' : 'en';
    langBtn.textContent = lang === 'en' ? 'ES' : 'EN';
    document.documentElement.lang = lang;
    renderFooter();
    // Re-render screens that hold no in-progress hardware state; others pick it up next screen.
    if (current && ['home', 'withdrawAmount', 'confirm', 'sent', 'takeCash'].includes(current.name)) show(current.name);
  });

  kiosk.ready.then(info => {
    console.log('kiosk ready', info);
    renderFooter();
  });
  renderFooter();
  goHome();
})();
