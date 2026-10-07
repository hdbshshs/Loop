const main = document.getElementById('view'), util = document.getElementById('util'), qIn = document.getElementById('q'), cartlink = document.getElementById('cartlink');
let me = null;
const h = (t, a = {}, ...k) => {
  const e = document.createElement(t);
  for (const [x, v] of Object.entries(a)) x.startsWith('on') ? e.addEventListener(x.slice(2), v) : e.setAttribute(x, v);
  e.append(...k.filter(x => x != null)); return e;
};
const api = async (u, m = 'GET', b) => {
  const r = await fetch('/api/' + u, { method: m, headers: { 'Content-Type': 'application/json' }, body: b && JSON.stringify(b) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'Something went wrong.');
  return d;
};
const usd = n => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const toast = m => { const t = document.getElementById('toast'); t.textContent = m; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 2500); };
const field = (label, el) => h('div', {}, h('label', {}, label), el);
const pic = (src, title) => src ? h('img', { class: 'pic', src, alt: title }) : h('div', { class: 'noimg' }, title[0].toUpperCase());

let emailSent = '';
let cart = [], cur = 'shop', meta = { categories: ['Everything Else'], conditions: ['New', 'Used', 'Not specified'], minPrice: 1, maxPrice: 50000, feeLow: 9, feeHigh: 13, feeAt: 100, payoutDays: 14, shipDays: 3, deliveryAuto: false };
try { cart = JSON.parse(localStorage.getItem('th_cart')) || []; } catch { cart = []; }
const cartSave = () => { try { localStorage.setItem('th_cart', JSON.stringify(cart)); } catch {} };
const cartCount = () => cart.reduce((a, c) => a + c.qty, 0);
const letter = t => t[0].toUpperCase();
document.getElementById('sf').addEventListener('submit', e => { e.preventDefault(); const v = qIn.value.trim(); location.hash = v ? '#/search/' + encodeURIComponent(v) : '#/'; });

function badge(on) { return on ? h('span', { class: 'badge', title: 'Loop admin' }, 'ADMIN') : null; }

function drawNav() {
  const out = h('button', { onclick: async () => { await api('logout', 'POST'); me = null; location.hash = '#/'; route(); } }, 'Log out');
  util.replaceChildren(
    h('div', {}, me ? h('span', {}, 'Hi ', h('a', { href: '#/user/' + encodeURIComponent(me.username) }, me.username), badge(me.admin), me.emailVerified === false ? h('button', { class: 'link', onclick: () => { location.hash = '#/confirm-email'; } }, ' Confirm your email') : null) : h('span', {}, 'Hi! ', h('a', { href: '#/login' }, 'Sign in or register'))),
    h('div', { class: 'r' }, h('a', { href: '#/' }, 'Shop'), h('a', { href: '#/sell' }, 'Sell'), h('a', { href: '#/snap' }, 'Snap & Sell'), ...(me ? [h('a', { href: '#/orders' }, 'My orders'), h('a', { href: '#/sales' }, 'My sales'), h('a', { href: '#/address' }, 'Address'), h('a', { href: '#/payouts' }, 'Payouts'), ...(me.admin ? [h('a', { href: '#/admin' }, 'Admin')] : []), out] : [])));
  cartlink.replaceChildren('Cart', cartCount() ? h('span', { class: 'count' }, cartCount()) : '');
}

function sell() {
  let image = null, draftId = null, cleaning = null, ver = 0;
  const gate = h('div');
  api('connect/status').then(s => { if (s.mode === 'stripe' && !s.ready) gate.append(h('div', { class: 'panel' }, h('strong', {}, 'Set up payouts first. '), 'Connect a bank account before you list items. ', h('a', { href: '#/payouts' }, 'Set up payouts'))); }, () => {});
  const f = { title: h('input', { maxlength: 80 }), price: h('input', { type: 'number', min: meta.minPrice, max: meta.maxPrice, step: 0.01 }),
    qty: h('input', { type: 'number', min: 1, max: 999, step: 1, value: 1 }), description: h('textarea', { rows: 4 }) };
  const cat = h('select', {}, ...meta.categories.map(c => h('option', { value: c }, c))), cond = h('select', {}, ...meta.conditions.map(c => h('option', { value: c }, c)));
  cat.value = 'Everything Else';
  const feeNote = h('div', { class: 'meta' });
  f.price.oninput = () => { const p = Number(f.price.value); if (!(p > 0)) { feeNote.textContent = ''; return; } const pc = p >= meta.feeAt ? meta.feeHigh : meta.feeLow; feeNote.textContent = `Fee ${pc}%. You receive about ${usd(p * (1 - pc / 100))} per item.`; };
  const file = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp' }), err = h('p', { class: 'err' });
  const post = h('button', { class: 'btn' }, 'Post listing');
  // When a photo is picked, the server cleans its background while the seller fills in the form. If that works, the cleaned photo is posted; if not, the plain photo is.
  file.onchange = () => {
    const f0 = file.files[0], my = ++ver; image = null; draftId = null; cleaning = null;
    if (!f0) return;
    cleaning = (async () => {
      try {
        const raw = await shrink(f0).catch(() => new Promise(ok => { const r = new FileReader(); r.onload = () => ok(r.result); r.readAsDataURL(f0); }));
        if (my === ver) image = raw;
        const res = await api('ai/snap', 'POST', { image: raw });
        if (my !== ver) return {};
        if (res.ai && res.draft && !res.draft.allowed) return { blocked: res.draft.reason || '' };
        if (res.ai && res.cleaned && res.draftId) draftId = res.draftId;
      } catch (x) { /* fall back to the plain photo */ }
      return {};
    })();
  };
  main.append(gate, h('form', { class: 'panel form-in', onsubmit: async e => {
    e.preventDefault();
    const pr = Number(f.price.value);
    if (!(pr >= meta.minPrice && pr <= meta.maxPrice)) { err.textContent = `Price must be between ${usd(meta.minPrice)} and ${usd(meta.maxPrice)}.`; return; }
    err.textContent = ''; post.disabled = true; post.textContent = cleaning ? 'Cleaning your photo...' : 'Posting...';
    const c = cleaning ? await cleaning : {};
    if (c.blocked !== undefined) { err.textContent = `Loop cannot list this item${c.blocked ? ': ' + c.blocked : ''}. See Prohibited Items in the footer.`; post.disabled = false; post.textContent = 'Post listing'; return; }
    try { await api('listings', 'POST', { title: f.title.value, price: f.price.value, qty: f.qty.value, description: f.description.value, category: cat.value, condition: cond.value, ...(draftId ? { draftId } : { image }) }); toast('Listed'); location.hash = '#/'; }
    catch (x) { err.textContent = x.message; post.disabled = false; post.textContent = 'Post listing'; }
  } }, h('h2', {}, 'List an item for sale'), h('p', { class: 'meta' }, `Loop keeps ${meta.feeLow}% of items priced under ${usd(meta.feeAt)} and ${meta.feeHigh}% of items at ${usd(meta.feeAt)} or more. You are paid ${meta.payoutDays} days after the buyer pays, once the order has shipped. Buyers may sometimes see a lower price than the one you set, because of Loop promotions that Loop pays for. You are always paid your price minus the fee.`), field('Title', f.title), h('div', { class: 'row' }, h('div', {}, field(`Price (USD, ${usd(meta.minPrice)} to ${usd(meta.maxPrice)})`, f.price), feeNote), field('Quantity', f.qty)),
    h('div', { class: 'row' }, field('Category', cat), field('Condition', cond)), field('Description', f.description), field('Photo', file), err, post));
}

async function payoutsPage() {
  const box = h('div', { class: 'panel form-in' }); main.append(box);
  let s; try { s = await api('connect/status'); } catch (x) { box.append(h('p', { class: 'err' }, x.message)); return; }
  box.append(h('h2', {}, 'Payouts'));
  if (s.mode !== 'stripe') { box.append(h('p', { class: 'meta' }, 'Payouts switch on when the site runs with live Stripe keys.')); return; }
  box.append(h('p', { class: 'meta' }, `Loop pays sellers through Stripe. We keep ${meta.feeLow}% of items under ${usd(meta.feeAt)} and ${meta.feeHigh}% of items at ${usd(meta.feeAt)} or more. You are paid ${meta.payoutDays} days after the buyer pays, as long as the order has shipped.`));
  if (s.ready) box.append(h('p', {}, '✓ Payouts are active. You can list items.'));
  else box.append(h('p', {}, s.started ? 'Your payout setup is not finished yet.' : 'Connect a bank account before you can list items.'),
    h('button', { class: 'btn', onclick: async () => { try { location.href = (await api('connect/onboard', 'POST')).url; } catch (x) { toast(x.message); } } }, s.started ? 'Continue setup' : 'Set up payouts'));
}

function addrForm(a = {}) {
  const f = {};
  const mk = (k, label, extra = {}) => { f[k] = h('input', { value: a[k] || '', ...extra }); return field(label, f[k]); };
  const el = h('div', {}, mk('name', 'Full name', { autocomplete: 'name' }), mk('street', 'Street address', { autocomplete: 'address-line1' }),
    mk('apt', 'Apt, suite, unit (optional)', { autocomplete: 'address-line2' }),
    h('div', { class: 'row' }, mk('city', 'City', { autocomplete: 'address-level2' }), mk('state', 'State / region', { autocomplete: 'address-level1' }), mk('zip', 'ZIP / postal code', { autocomplete: 'postal-code' })),
    mk('country', 'Country', { autocomplete: 'country-name' }));
  if (!a.country) f.country.value = 'United States';
  return { el, get: () => Object.fromEntries(Object.entries(f).map(([k, i]) => [k, i.value])) };
}

function addressView() {
  const af = addrForm(me.address || {}), err = h('p', { class: 'err' });
  main.append(h('form', { class: 'panel form-in', onsubmit: async e => {
    e.preventDefault();
    try { me.address = (await api('address', 'POST', af.get())).address; err.textContent = ''; toast('Address saved'); }
    catch (x) { err.textContent = x.message; }
  } }, h('h2', {}, 'Shipping address'), h('p', { class: 'meta' }, 'Sellers use this address to ship your orders.'), af.el, err, h('button', { class: 'btn' }, 'Save address')));
}

const luhn = n => { let t = 0; [...n].reverse().forEach((c, i) => { let d = +c; if (i % 2) { d *= 2; if (d > 9) d -= 9; } t += d; }); return t % 10 === 0; };
const TEST_CARDS = { 4242424242424242: 'approve', 4000000000000002: 'decline', 4100000000000019: 'fraud' };

async function payPage(id) {
  let p; try { p = await api('payments/' + encodeURIComponent(id)); } catch (x) { main.append(h('p', { class: 'empty' }, x.message)); return; }
  if (p.status !== 'pending') { location.hash = '#/paid/' + id; return; }
  if (p.mode === 'stripe') { main.append(h('p', { class: 'empty' }, 'Taking you to the secure payment page...')); location.href = p.url; return; }
  const name = h('input', { autocomplete: 'cc-name' }), num = h('input', { inputmode: 'numeric', autocomplete: 'cc-number', placeholder: '4242 4242 4242 4242', maxlength: 23 });
  const exp = h('input', { inputmode: 'numeric', autocomplete: 'cc-exp', placeholder: 'MM/YY', maxlength: 5 }), cvc = h('input', { inputmode: 'numeric', autocomplete: 'cc-csc', placeholder: 'CVC', maxlength: 4 });
  const err = h('p', { class: 'err' });
  num.oninput = () => { num.value = num.value.replace(/\D/g, '').slice(0, 19).replace(/(.{4})/g, '$1 ').trim(); };
  exp.oninput = () => { const d = exp.value.replace(/\D/g, '').slice(0, 4); exp.value = d.length > 2 ? d.slice(0, 2) + '/' + d.slice(2) : d; };
  main.append(h('div', { class: 'cartgrid' }, h('form', { class: 'panel form-in', onsubmit: async e => {
    e.preventDefault();
    const digits = num.value.replace(/\s/g, ''), m = /^(\d\d)\/(\d\d)$/.exec(exp.value), now = new Date();
    if (name.value.trim().length < 2) { err.textContent = 'Enter the name on the card.'; return; }
    if (!/^\d{13,19}$/.test(digits) || !luhn(digits)) { err.textContent = 'That card number is not valid.'; return; }
    if (!m || +m[1] < 1 || +m[1] > 12 || (2000 + +m[2]) * 12 + +m[1] <= now.getFullYear() * 12 + now.getMonth()) { err.textContent = 'Enter a card expiry date in the future.'; return; }
    if (!/^\d{3,4}$/.test(cvc.value)) { err.textContent = 'Enter the 3 or 4 digit security code.'; return; }
    const scenario = TEST_CARDS[digits];
    if (!scenario) { err.textContent = 'Demo mode only accepts test cards. Use 4242 4242 4242 4242. Never enter a real card here.'; return; }
    try { await api(`payments/${id}/demo-card`, 'POST', { scenario }); [name, num, exp, cvc].forEach(i => { i.value = ''; }); location.hash = '#/paid/' + id; }
    catch (x) { err.textContent = x.message; }
  } }, h('h2', {}, 'Payment'), h('p', { class: 'meta' }, 'TEST MODE: no real money moves. Cards: 4242 4242 4242 4242 is approved, 4000 0000 0000 0002 is declined by the bank, 4100 0000 0000 0019 is stopped by the fraud check. Any future expiry and any CVC.'),
    field('Name on card', name), field('Card number', num), h('div', { class: 'row' }, field('Expiry', exp), field('Security code', cvc)), err, h('button', { class: 'btn' }, `Pay ${usd(p.amount)}`)),
    h('div', { class: 'panel' }, h('h3', {}, 'Order summary'), ...p.orders.map(o => h('div', { class: 'line' }, h('div', { class: 'grow' }, o.title, h('div', { class: 'meta' }, `Qty ${o.qty}`)), h('strong', {}, usd(o.total)))),
      h('div', { class: 'sum' }, h('span', {}, 'Total'), h('span', {}, usd(p.amount))))));
}

async function paidPage(id) {
  const box = h('div', { class: 'panel done-card' }); main.append(box);
  const labels = ['Payment details', 'Fraud check', 'Bank approval'], at = { pending: 0, fraud_check: 1, bank_pending: 2 };
  const text = { pending: 'Waiting for your payment...', fraud_check: 'Running the fraud check...', bank_pending: 'Waiting for your bank to approve...' };
  const why = { blocked: ['Payment blocked', 'Our fraud check stopped this payment. Your card was not charged.'], declined: ['Payment declined', 'Your bank did not approve it, so the order was cancelled and your card was not charged.'],
    expired: ['Payment timed out', 'We never got a payment, so the order was cancelled and the items are back for sale.'] };
  const tick = async () => {
    if (location.hash !== '#/paid/' + id) return;
    let p; try { p = await api('payments/' + encodeURIComponent(id)); } catch (x) { box.replaceChildren(h('p', { class: 'err' }, x.message)); return; }
    if (p.status === 'paid') { cart = cart.filter(c => !p.orders.some(o => o.listingId === c.id)); cartSave(); confirmation(p.orders); return; }
    if (why[p.status]) { box.replaceChildren(h('h2', {}, why[p.status][0]), h('p', { class: 'meta' }, why[p.status][1]), h('a', { class: 'btn', href: '#/cart' }, 'Back to cart')); return; }
    box.replaceChildren(h('div', { class: 'spin', 'aria-hidden': 'true' }), h('h2', {}, text[p.status] || 'Processing...'),
      h('div', { class: 'track' }, ...labels.map((t, i) => h('span', { class: i <= (at[p.status] || 0) ? 'done' : '' }, t))),
      h('p', { class: 'meta' }, 'Keep this page open. Your order only goes through once the bank says yes.'));
    setTimeout(tick, 900);
  };
  tick();
}

const steps = ['Placed', 'Shipped', 'Delivered'];
// Delivery countdown. This replaces status words: the buyer sees a live clock to the seller's delivery estimate.
const pad = n => String(n).padStart(2, '0');
function tick(e) {
  const until = +e.dataset.until, from = +e.dataset.from, ms = until - Date.now();
  if (ms <= 0) e.textContent = 'Any moment now';
  else { const s = Math.floor(ms / 1000), d = Math.floor(s / 86400); e.textContent = `${d ? d + 'd ' : ''}${pad(Math.floor(s % 86400 / 3600))}:${pad(Math.floor(s % 3600 / 60))}:${pad(s % 60)}`; }
  const bar = e.parentElement && e.parentElement.querySelector('.tbar i');
  if (bar) bar.style.width = Math.min(Math.max((Date.now() - from) / Math.max(until - from, 1), 0), 1) * 100 + '%';
}
setInterval(() => document.querySelectorAll('[data-until]').forEach(tick), 1000);
function timerEl(o, seller) {
  let label, until, from;
  if (o.status === 'Placed' && o.paidAt) { label = seller ? 'Ship within' : 'Seller ships within'; until = o.paidAt + meta.shipDays * 864e5; from = o.paidAt; }
  else if (o.status === 'Shipped') { label = seller ? 'Buyer expects it in' : 'Arrives in'; from = o.shippedAt || Date.now(); until = o.etaAt || from + 5 * 864e5; }
  else if (o.status === 'Delivered') return h('div', { class: 'timer done' }, h('div', { class: 'tlabel' }, 'Delivered'), h('div', { class: 'tnum' }, o.deliveredAt ? new Date(o.deliveredAt).toLocaleDateString() : ''));
  else return h('span');
  const num = h('div', { class: 'tnum', 'data-until': String(until), 'data-from': String(from) });
  const box = h('div', { class: 'timer' }, h('div', { class: 'tlabel' }, label), num, h('div', { class: 'tbar' }, h('i')));
  tick(num); return box;
}

// "Refund" asks for a reason first. The buyer always gets the full amount back.
function refundBox(o, seller, done) {
  const why = h('textarea', { rows: 3, maxlength: 300, placeholder: seller ? 'Why are you refunding this order? The buyer will see this.' : 'Why are you cancelling this order?' }), err = h('p', { class: 'err' });
  const go = h('button', { class: 'btn alt' }, `Refund ${usd(o.total)} in full`);
  const form = h('form', { class: 'form-in refundform', onsubmit: async e => {
    e.preventDefault();
    if (why.value.trim().length < 5) { err.textContent = 'Please tell us why. A few words is enough.'; return; }
    err.textContent = ''; go.disabled = true; await done('refund', { reason: why.value.trim() }); go.disabled = false;
  } }, why, h('p', { class: 'meta' }, `The buyer gets all ${usd(o.total)} back right away. Their bank decides when it shows up, usually within 5 to 10 business days.`), err, go);
  form.hidden = true;
  const open = h('button', { type: 'button', class: 'link', onclick: () => { form.hidden = !form.hidden; if (!form.hidden) why.focus(); } }, seller ? 'Refund the buyer' : 'Cancel and refund');
  return h('div', {}, open, form);
}

function ord(o, seller) {
  const at = steps.indexOf(o.status), err = h('p', { class: 'err' });
  const info = h('div', { class: 'info' }, h('div', { class: 'num' }, o.number), h('div', {}, `${o.qty} × ${o.title} — ${usd(seller && o.gross != null ? o.gross : o.total)}`),
    h('div', { class: 'meta' }, seller ? `Buyer: ${o.buyerName}` : `Seller: ${o.sellerName}`),
    timerEl(o, seller));
  if (seller) info.append(h('div', { class: 'meta addr' }, 'Ship to:\n' + o.address));
  if (o.status === 'Shipped' || o.status === 'Delivered') info.append(h('div', { class: 'meta' }, `Shipped via ${o.carrier}${o.tracking ? ', tracking ' + o.tracking : ''}`));
  if (o.status === 'Awaiting payment') info.append(h('div', { class: 'meta' }, 'Payment not completed yet. ', h('a', { href: '#/pay/' + o.paymentId }, 'Pay now')));
  if (o.status === 'Cancelled') info.append(o.refunded ? h('div', { class: 'meta' }, `Refunded in full: ${usd(o.total)}. Reason: ${o.refundReason || 'not given'}. Loop sent the refund right away. Your bank decides when it shows up, usually within 5 to 10 business days.`) : h('div', { class: 'meta low' }, 'Cancelled: the payment was not completed.'));
  const done = async (path, body) => { try { await api(`orders/${o.id}/${path}`, 'POST', body); route(); } catch (x) { err.textContent = x.message; } };
  if (seller && o.status === 'Placed') {
    const c = h('input', { placeholder: 'Carrier (USPS, UPS...)' }), t = h('input', { placeholder: 'Tracking number' });
    const dd = h('select', { 'aria-label': 'Estimated delivery time' }, ...[1, 2, 3, 4, 5, 6, 7, 10, 14].map(n => h('option', { value: n, ...(n === 5 ? { selected: '' } : {}) }, `Arrives in ${n} day${n > 1 ? 's' : ''}`)));
    info.append(h('form', { class: 'row', onsubmit: e => { e.preventDefault(); done('ship', { carrier: c.value, tracking: t.value, days: dd.value }); } }, c, t, dd, h('button', { class: 'btn alt' }, 'Mark as shipped')),
      h('div', { class: 'meta' }, meta.deliveryAuto
        ? 'Arrival uses route distance and current weather alerts when both addresses have U.S. ZIP codes. The day choice is the fallback.'
        : 'Choose the arrival estimate. Add ORS_API_KEY on the server to enable route and weather estimates.'));
  }
  if (!seller && o.status === 'Shipped') info.append(h('button', { class: 'btn alt', onclick: () => done('received') }, 'Mark as received'));
  if (o.status === 'Placed' || (seller && (o.status === 'Shipped' || o.status === 'Delivered') && !(o.payout && o.payout.status === 'paid'))) info.append(refundBox(o, seller, done));
  if (seller && o.off) info.append(h('div', { class: 'meta' }, `The buyer paid ${usd(o.total)}. Loop paid ${usd(o.off * o.qty)} of the price, so you still get your full price minus the fee.`));
  if (seller && o.paidAt && ['Placed', 'Shipped', 'Delivered'].includes(o.status)) {
    const on = new Date(o.paidAt + meta.payoutDays * 864e5).toLocaleDateString(), pc = o.feePercent != null ? o.feePercent : (o.unit >= meta.feeAt ? meta.feeHigh : meta.feeLow);
    info.append(h('div', { class: 'meta' }, o.payout && o.payout.status === 'paid' ? `Payout sent: ${usd(o.payout.amount)} (after the ${pc}% fee)` : o.payout && o.payout.status === 'failed' ? 'Payout is pending. It is retried automatically.'
      : `You are paid on ${on} (after the ${pc}% fee)${o.status === 'Placed' ? ', once the order has shipped' : ''}.`));
  }
  info.append(err);
  return h('div', { class: 'panel ord' }, o.image ? h('img', { src: o.image, alt: o.title }) : h('div', { class: 'noimg' }, letter(o.title)), info);
}

const lists = (path, seller, empty) => async () => {
  const list = await api(path);
  main.append(h('h2', {}, seller ? 'Orders to ship' : 'Your orders'), ...(list.length ? list.map(o => ord(o, seller)) : [h('p', { class: 'empty' }, empty)]));
};
const orders = lists('orders', false, 'No orders yet. Find something in the shop.');
const sales = lists('sales', true, 'No sales yet. Orders for your listings show up here.');

const findHash = p => '#/find/' + encodeURIComponent(p.toString());

async function results(p) {
  qIn.value = p.get('q') || '';
  const per = [60, 120, 240].includes(+p.get('per')) ? +p.get('per') : 60, page = Math.max(parseInt(p.get('page'), 10) || 1, 1), list = p.get('view') === 'list', filtered = [...p].length > 0;
  const go = kv => { const np = new URLSearchParams(p); np.delete('page'); for (const [k, v] of Object.entries(kv)) v ? np.set(k, v) : np.delete(k); location.hash = [...np].length ? findHash(np) : '#/'; };
  const title = h('h2', {}, p.get('q') ? `Results for "${p.get('q')}"` : 'Fresh listings'), grid = h('div', { class: list ? 'rows' : 'grid' }), pager = h('div', { class: 'pager' });
  const cur = p.get('sort') || '';
  const sort = h('select', { 'aria-label': 'Sort by' }, ...[['', 'Newest first'], ['best', 'Best match'], ['lo', 'Price: lowest first'], ['hi', 'Price: highest first']].map(([v, t]) => h('option', { value: v, ...(cur === v ? { selected: '' } : {}) }, t)));
  sort.onchange = () => go({ sort: sort.value });
  const cat = h('select', { 'aria-label': 'Category' }, ...['All Categories', ...meta.categories].map(c => h('option', { value: c === 'All Categories' ? '' : c, ...(p.get('cat') === c ? { selected: '' } : {}) }, c)));
  cat.onchange = () => go({ cat: cat.value });
  const min = h('input', { type: 'number', min: 0, placeholder: 'Min', value: p.get('min') || '', 'aria-label': 'Minimum price' }), max = h('input', { type: 'number', min: 0, placeholder: 'Max', value: p.get('max') || '', 'aria-label': 'Maximum price' });
  const side = h('aside', { class: 'filters' }, h('h3', {}, 'Category'), cat, h('h3', {}, 'Price (USD)'), h('div', { class: 'row' }, min, max),
    h('button', { class: 'btn alt small', onclick: () => go({ min: min.value, max: max.value }) }, 'Apply'), h('p', {}, h('a', { href: '#/advanced' }, 'Advanced search')));
  main.append(h('div', { class: 'results' }, side, h('div', {}, h('div', { class: 'bar' }, title, sort), grid, pager)));
  grid.replaceChildren(...Array.from({ length: 8 }, () => h('div', { class: 'skel' })));
  const all = await api('listings?' + p.toString());
  if (filtered) title.textContent = `${all.length} result${all.length === 1 ? '' : 's'}` + (p.get('q') ? ` for "${p.get('q')}"` : '');
  const slice = all.slice((page - 1) * per, page * per);
  grid.replaceChildren(...(slice.length ? slice.map(list ? row : card) : [h('p', { class: 'empty' }, filtered ? 'Nothing matches. Try fewer filters or different words.' : 'No listings yet. Be the first to sell something.')]));
  const pages = Math.ceil(all.length / per);
  if (pages > 1) pager.append(h('button', { class: 'btn alt small', ...(page > 1 ? {} : { disabled: '' }), onclick: () => go({ page: page - 1 }) }, 'Previous'),
    h('span', { class: 'meta' }, `Page ${page} of ${pages}`), h('button', { class: 'btn alt small', ...(page < pages ? {} : { disabled: '' }), onclick: () => go({ page: page + 1 }) }, 'Next'));
}

function row(l) {
  const href = '#/item/' + l.id, own = me && me.id === l.sellerId;
  return h('div', { class: 'rowitem' }, h('a', { href, class: 'imgwrap' }, pic(l.image, l.title)), h('div', { class: 'grow' }, h('h3', {}, h('a', { href }, l.title)),
    h('div', { class: 'meta' }, `${l.condition || 'Not specified'}, ${l.category || 'Everything Else'}`), h('div', { class: 'price' }, usd(l.pay)), h('div', { class: 'meta' }, `${l.qty} available`),
    h('a', { class: 'seller', href: '#/user/' + encodeURIComponent(l.seller) }, l.seller, badge(l.sellerAdmin), ` (${l.sold} sold)`)),
    own ? h('button', { class: 'btn small', disabled: '' }, 'Your listing') : h('a', { class: 'btn small', href: `#/checkout/${l.id}/1` }, 'Buy It Now'));
}

function advanced() {
  const kw = h('input', { placeholder: 'Enter keywords or item number' }), ex = h('input', { placeholder: 'Words to leave out' }), seller = h('input', { placeholder: 'Seller names, separated by commas or spaces' });
  const opts = (list, val = x => x) => list.map(x => h('option', { value: Array.isArray(x) ? x[0] : val(x) }, Array.isArray(x) ? x[1] : x));
  const mode = h('select', {}, ...opts([['all', 'All words, any order'], ['any', 'Any words, any order'], ['exact', 'Exact words, exact order'], ['words', 'Exact words, any order']]));
  const cat = h('select', {}, ...opts([['', 'All Categories'], ...meta.categories.map(c => [c, c])]));
  const desc = h('input', { type: 'checkbox' }), pmin = h('input', { type: 'number', min: 0, placeholder: 'Min price' }), pmax = h('input', { type: 'number', min: 0, placeholder: 'Max price' });
  const conds = meta.conditions.map(c => [c, h('input', { type: 'checkbox' })]), qmin = h('input', { type: 'number', min: 1, placeholder: 'Min quantity' }), qmax = h('input', { type: 'number', min: 1, placeholder: 'Max quantity' });
  const sxIn = h('input', { type: 'radio', name: 'sx', checked: '' }), sxEx = h('input', { type: 'radio', name: 'sx' });
  const sort = h('select', {}, ...opts([['best', 'Best match'], ['', 'Newly listed'], ['lo', 'Price: lowest first'], ['hi', 'Price: highest first']]));
  const view = h('select', {}, ...opts([['', 'Gallery view'], ['list', 'List view']])), per = h('select', {}, ...opts([['60', '60'], ['120', '120'], ['240', '240']]));
  const sec = (t, ...k) => h('div', { class: 'section' }, h('h2', {}, t), ...k);
  main.append(h('form', { class: 'panel adv', onsubmit: e => {
    e.preventDefault();
    const k = kw.value.trim();
    if (/^[0-9a-f]{16}$/i.test(k)) { location.hash = '#/item/' + k.toLowerCase(); return; }
    const p = new URLSearchParams(), set = (n, v) => { if (v) p.set(n, v); };
    set('q', k); set('mode', mode.value === 'all' ? '' : mode.value); set('ex', ex.value.trim()); set('cat', cat.value); if (desc.checked) p.set('desc', '1');
    set('min', pmin.value); set('max', pmax.value); set('cond', conds.filter(c => c[1].checked).map(c => c[0]).join(',')); set('qmin', qmin.value); set('qmax', qmax.value);
    set('seller', seller.value.trim()); if (seller.value.trim() && sxEx.checked) p.set('sx', '1'); set('sort', sort.value); set('view', view.value); set('per', per.value === '60' ? '' : per.value);
    location.hash = [...p].length ? findHash(p) : '#/';
  } }, h('h2', {}, 'Find items'), field('Keywords', kw), field('Keyword options', mode), field('Exclude words from your search', ex), field('In this category', cat),
    h('label', { class: 'chk' }, desc, 'Search title and description'), sec('Price', h('div', { class: 'row' }, pmin, pmax)),
    sec('Condition', h('div', { class: 'chks' }, ...conds.map(([t, el]) => h('label', { class: 'chk' }, el, t)))), sec('Multiple items from', h('div', { class: 'row' }, qmin, qmax)),
    sec('Sellers', seller, h('div', { class: 'chks' }, h('label', { class: 'chk' }, sxIn, 'Only show these sellers'), h('label', { class: 'chk' }, sxEx, 'Hide these sellers'))),
    sec('Sort by', sort), sec('View results', view), sec('Results per page', per), h('button', { class: 'btn' }, 'Search')));
}

function card(l) {
  const href = '#/item/' + l.id, own = me && me.id === l.sellerId, cond = l.condition && l.condition !== 'Not specified' ? l.condition + ', ' : '';
  return h('div', { class: 'card' }, h('a', { href, class: 'imgwrap' }, pic(l.image, l.title)), h('div', { class: 'body' },
    h('h3', {}, h('a', { href }, l.title)), h('div', { class: 'price' }, usd(l.pay)),
    h('div', { class: 'meta' }, l.qty <= 3 ? h('span', { class: 'low' }, `Only ${l.qty} left`) : `${cond}${l.qty} available`),
    h('a', { class: 'seller', href: '#/user/' + encodeURIComponent(l.seller) }, l.seller, badge(l.sellerAdmin), ` (${l.sold} sold)`),
    own ? h('button', { class: 'btn small wide', disabled: '' }, 'Your listing') : h('a', { class: 'btn small wide', href: `#/checkout/${l.id}/1` }, 'Buy It Now')));
}

async function item(id) {
  let l; try { l = await api('listings/' + encodeURIComponent(id)); } catch (x) { main.append(h('p', { class: 'empty' }, x.message)); return; }
  const own = me && me.id === l.sellerId, qty = h('input', { type: 'number', min: 1, max: Math.max(l.qty, 1), value: 1, 'aria-label': 'Quantity' });
  const n = () => Math.min(Math.max(parseInt(qty.value, 10) || 1, 1), l.qty);
  const acts = h('div', { class: 'actions' });
  if (own) acts.append(h('button', { class: 'btn', disabled: '' }, 'Buy It Now'), h('span', { class: 'meta' }, "This is your listing, so you can't buy it."));
  else if (l.qty < 1) acts.append(h('span', { class: 'low' }, 'Sold out'));
  else acts.append(h('button', { class: 'btn', onclick: () => { location.hash = `#/checkout/${l.id}/${n()}`; } }, 'Buy It Now'),
    h('button', { class: 'btn alt', onclick: () => {
      const c = cart.find(x => x.id === l.id); if (c) c.qty = Math.min(c.qty + n(), l.qty); else cart.push({ id: l.id, qty: n() });
      cartSave(); drawNav(); toast('Added to cart');
    } }, 'Add to cart'));
  const stats = await api('users/' + encodeURIComponent(l.seller)).catch(() => null);
  main.append(h('a', { href: '#/', class: 'crumb' }, 'Back to all listings'), h('div', { class: 'item' }, pic(l.image, l.title), h('div', {},
    h('h1', {}, l.title), h('div', { class: 'meta' }, 'Seller: ', h('a', { href: '#/user/' + encodeURIComponent(l.seller) }, l.seller), badge(l.sellerAdmin), ` (${l.sold} sold)`),
    h('div', { class: 'bigprice' }, usd(l.pay)), own && l.yourPrice != null && l.yourPrice !== l.pay ? h('div', { class: 'meta' }, `You listed this at ${usd(l.yourPrice)}. Buyers see ${usd(l.pay)} because of a promotion Loop pays for, so you are still paid ${usd(l.yourPrice)} minus the fee.`) : null,
    h('div', { class: 'kv' }, h('span', { class: 'k' }, 'Quantity'), h('span', {}, ...(own || l.qty < 1 ? [] : [qty]), h('span', { class: 'meta' }, l.qty > 0 ? `  ${l.qty} available` : 'No stock left')),
      h('span', { class: 'k' }, 'Condition'), h('span', {}, l.condition || 'Not specified'), h('span', { class: 'k' }, 'Category'), h('span', {}, l.category || 'Everything Else'), h('span', { class: 'k' }, 'Shipping'), h('span', {}, 'Ships direct from the seller after you order')), acts)),
    h('div', { class: 'section' }, h('h2', {}, 'About this item'), h('p', { class: 'addr' }, l.description || 'The seller did not add a description.')),
    h('div', { class: 'section' }, h('h2', {}, 'About this seller'), h('div', { class: 'sellerbox' }, h('div', { class: 'av' }, letter(l.seller)),
      h('div', {}, h('a', { href: '#/user/' + encodeURIComponent(l.seller) }, h('strong', {}, l.seller)), badge(l.sellerAdmin), h('div', { class: 'meta' }, stats ? `${stats.sold} item${stats.sold === 1 ? '' : 's'} sold` : ''),
        h('a', { href: '#/user/' + encodeURIComponent(l.seller) }, 'See their profile and other items')))));
}

async function user(name) {
  let u; try { u = await api('users/' + encodeURIComponent(name)); } catch (x) { main.append(h('p', { class: 'empty' }, x.message)); return; }
  main.append(h('div', { class: 'profile' }, h('div', { class: 'av' }, letter(u.username)),
    h('div', {}, h('h1', {}, u.username, badge(u.admin)), h('div', { class: 'meta' }, `${u.sold} sold, ${u.listings.length} for sale`))),
    h('div', { class: 'bar' }, h('h2', {}, 'Items for sale')),
    h('div', { class: 'grid' }, ...(u.listings.length ? u.listings.map(card) : [h('p', { class: 'empty' }, 'Nothing for sale right now.')])));
}

async function rowsFor(src) {
  const got = await Promise.all(src.map(c => api('listings/' + encodeURIComponent(c.id)).then(l => ({ l, c }), () => null)));
  const rows = got.filter(r => r && r.l.qty > 0);
  rows.forEach(r => { r.c.qty = Math.min(r.c.qty, r.l.qty); });
  return rows;
}
const total = rows => rows.reduce((a, r) => a + r.l.pay * r.c.qty, 0);
const lineEl = (r, extra) => h('div', { class: 'line' }, pic(r.l.image, r.l.title), h('div', { class: 'grow' }, h('a', { href: '#/item/' + r.l.id }, r.l.title),
  h('div', { class: 'meta' }, `${usd(r.l.pay)} each, sold by ${r.l.seller}`)), ...extra);
const summary = (rows, ...k) => h('div', { class: 'panel' }, h('div', { class: 'meta' }, `Items (${rows.reduce((a, r) => a + r.c.qty, 0)})`),
  h('div', { class: 'sum' }, h('span', {}, 'Total'), h('span', {}, usd(total(rows)))), ...k);

async function cartView() {
  main.append(h('h2', {}, 'Shopping cart'));
  const rows = await rowsFor(cart);
  cart = rows.map(r => r.c); cartSave(); drawNav();
  if (!rows.length) { main.append(h('p', { class: 'empty' }, 'Your cart is empty. Find something in the shop.')); return; }
  main.append(h('div', { class: 'cartgrid' }, h('div', { class: 'panel' }, ...rows.map(r => lineEl(r, [
    h('input', { type: 'number', min: 1, max: r.l.qty, value: r.c.qty, 'aria-label': 'Quantity', onchange: e => { r.c.qty = Math.min(Math.max(parseInt(e.target.value, 10) || 1, 1), r.l.qty); cartSave(); route(); } }),
    h('strong', {}, usd(r.l.pay * r.c.qty)),
    h('button', { class: 'link', onclick: () => { cart = cart.filter(c => c !== r.c); cartSave(); route(); } }, 'Remove')]))),
    summary(rows, h('button', { class: 'btn wide', onclick: () => { location.hash = '#/checkout'; } }, 'Go to checkout'))));
}

async function checkout(id, n) {
  if (!me) { location.hash = '#/login'; return; }
  const rows = await rowsFor(id ? [{ id, qty: parseInt(n, 10) || 1 }] : cart);
  if (!rows.length) { location.hash = '#/cart'; return; }
  const af = addrForm(me.address || {}), saveBox = h('input', { type: 'checkbox', checked: '' }), err = h('p', { class: 'err' });
  main.append(h('form', { class: 'cartgrid', onsubmit: async e => {
    e.preventDefault();
    try {
      const res = await api('checkout', 'POST', { items: rows.map(r => ({ listingId: r.l.id, qty: r.c.qty })), address: af.get(), save: saveBox.checked });
      if (res.address) me.address = res.address; location.hash = '#/pay/' + res.payment.id;
    } catch (x) { err.textContent = x.message; }
  } }, h('div', { class: 'panel' }, h('h2', {}, 'Checkout'), h('h3', {}, 'Ship to'), af.el, h('label', { class: 'chk' }, saveBox, 'Save this address to my account'), h('div', { class: 'section' }, ...rows.map(r => lineEl(r, [h('span', {}, `Qty ${r.c.qty}`), h('strong', {}, usd(r.l.pay * r.c.qty))])))),
    summary(rows, err, h('button', { class: 'btn wide' }, 'Continue to payment'))));
}

function confirmation(orders) {
  scrollTo(0, 0); drawNav();
  const many = orders.length > 1;
  main.replaceChildren(h('div', { class: 'panel done-card' }, h('div', { class: 'ok', 'aria-hidden': 'true' }, '✓'), h('h2', {}, many ? 'Thanks, your orders are placed' : 'Thanks, your order is placed'),
    h('p', { class: 'meta' }, many ? 'Order numbers' : 'Order number'),
    ...orders.map(o => h('div', {}, h('div', { class: 'big' }, o.number), h('p', { class: 'meta' }, `${o.qty} × ${o.title}, ${usd(o.total)}. ${o.sellerName} will ship it to you.`))),
    h('p', { class: 'meta addr' }, 'Shipping to:\n' + orders[0].address), h('a', { href: '#/orders', class: 'btn' }, 'Track your orders')));
}

function loginView() {
  let mode = 'login';
  const user = h('input', { autocomplete: 'username' }), pw = h('input', { type: 'password', autocomplete: 'current-password' });
  const email = h('input', { type: 'email', autocomplete: 'email' }), agree = h('input', { type: 'checkbox' });
  const emailRow = field('Email', email), forgot = h('p', {}, h('a', { href: '#/forgot' }, 'Forgot your password?'));
  const agreeRow = h('label', { class: 'chk' }, agree, h('span', {}, 'I am 18 or older and agree to the ', h('a', { href: '/legal/terms.html', target: '_blank', rel: 'noopener' }, 'Terms'), ' and ', h('a', { href: '/legal/privacy.html', target: '_blank', rel: 'noopener' }, 'Privacy Policy')));
  emailRow.hidden = agreeRow.hidden = true;
  const err = h('p', { class: 'err' }), title = h('h2', {}, 'Sign in to Loop'), go = h('button', { class: 'btn wide' }, 'Sign in'), sw = h('button', { type: 'button', class: 'btn alt wide' }, 'Create account');
  sw.onclick = () => {
    mode = mode === 'login' ? 'signup' : 'login'; const login = mode === 'login';
    title.textContent = login ? 'Sign in to Loop' : 'Create your account'; go.textContent = login ? 'Sign in' : 'Create account'; sw.textContent = login ? 'Create account' : 'Back to sign in';
    emailRow.hidden = agreeRow.hidden = login; forgot.hidden = !login; pw.setAttribute('autocomplete', login ? 'current-password' : 'new-password'); err.textContent = '';
  };
  main.append(h('div', { class: 'authwrap' }, h('form', { class: 'panel', onsubmit: async e => {
    e.preventDefault();
    try {
      me = (await api(mode, 'POST', mode === 'login' ? { username: user.value, password: pw.value } : { username: user.value, password: pw.value, email: email.value, agree: agree.checked })).user;
      if (mode === 'signup') { emailSent = me.email || email.value.trim().toLowerCase(); location.hash = '#/confirm-email'; } else location.hash = '#/';
      route();
    } catch (x) { err.textContent = x.message; }
  } }, title, field('Username', user), emailRow, field('Password', pw), agreeRow, forgot, err, go, sw)));
}

async function verifyPage(token) {
  const box = h('div', { class: 'panel done-card' }, h('p', { class: 'meta' }, 'Confirming your email...')); main.append(box);
  try {
    await api('verify', 'POST', { token }); if (me) me.emailVerified = true; drawNav();
    box.replaceChildren(h('div', { class: 'ok', 'aria-hidden': 'true' }, '✓'), h('h2', {}, 'Email confirmed'), h('a', { class: 'btn', href: '#/' }, 'Start shopping'));
  } catch (x) { box.replaceChildren(h('h2', {}, 'Could not confirm'), h('p', { class: 'meta' }, x.message), h('a', { class: 'btn', href: '#/' }, 'Back to Loop')); }
}

function forgotPage() {
  const email = h('input', { type: 'email', autocomplete: 'email' }), msg = h('p', { class: 'meta' });
  main.append(h('div', { class: 'authwrap' }, h('form', { class: 'panel', onsubmit: async e => {
    e.preventDefault();
    try { await api('forgot', 'POST', { email: email.value }); msg.textContent = 'If that email has an account, a reset link is on its way. It works for one hour.'; }
    catch (x) { msg.textContent = x.message; }
  } }, h('h2', {}, 'Reset your password'), field('Email', email), msg, h('button', { class: 'btn wide' }, 'Send reset link'))));
}

function resetPage(token) {
  const pw = h('input', { type: 'password', autocomplete: 'new-password' }), msg = h('p', { class: 'err' });
  main.append(h('div', { class: 'authwrap' }, h('form', { class: 'panel', onsubmit: async e => {
    e.preventDefault();
    try { await api('reset', 'POST', { token, password: pw.value }); me = null; drawNav(); main.replaceChildren(h('div', { class: 'panel done-card' }, h('div', { class: 'ok', 'aria-hidden': 'true' }, '✓'), h('h2', {}, 'Password changed'), h('a', { class: 'btn', href: '#/login' }, 'Sign in'))); }
    catch (x) { msg.textContent = x.message; }
  } }, h('h2', {}, 'Choose a new password'), field('New password (8+ characters)', pw), msg, h('button', { class: 'btn wide' }, 'Change password'))));
}

async function adminPage() {
  if (!me.admin) { main.append(h('p', { class: 'empty' }, 'Not found.')); return; }
  let d; try { d = await api('admin/overview'); } catch (x) { main.append(h('p', { class: 'empty' }, x.message)); return; }
  const when = t => new Date(t).toLocaleString(), td = (...k) => h('td', {}, ...k);
  const act = async (path, label, body) => { try { await api(path, 'POST', body); toast(label); route(); } catch (x) { toast(x.message); } };
  const tbl = (head, rows) => h('div', { class: 'scroll' }, h('table', { class: 'tbl' }, h('thead', {}, h('tr', {}, ...head.map(t => h('th', {}, t)))), h('tbody', {}, ...rows)));
  const S = d.stats;
  main.append(h('h2', {}, 'Admin'), h('div', { class: 'stats' }, ...[['Users', S.users], ['Live listings', S.listings], ['Orders', S.orders], ['Payments waiting', S.waiting], ['Paid, last 24h', usd(S.paid24h)], ['Photo helper uses today', d.snapsToday], ['Loop discounts given', `${usd(d.deals.used)} of ${usd(d.deals.budget)}`]]
    .map(([k, v]) => h('div', { class: 'panel' }, h('div', { class: 'meta' }, k), h('div', { class: 'big2' }, String(v))))),
    h('div', { class: 'section' }, h('h2', {}, 'Recent payments'), tbl(['When', 'Buyer', 'Amount', 'Status'], d.payments.map(p => h('tr', {}, td(when(p.at)), td(p.user), td(usd(p.amount)), td(p.status))))),
    d.failedPayouts.length ? h('div', { class: 'section' }, h('h2', {}, 'Failed payouts'), tbl(['Order', 'Seller', 'Total', 'Error', ''], d.failedPayouts.map(o => h('tr', {}, td(o.number), td(o.seller), td(usd(o.total)), td(o.error),
      td(h('button', { class: 'link', onclick: () => act(`admin/orders/${o.id}/retry-payout`, 'Retrying payout') }, 'Retry')))))) : null,
    h('div', { class: 'section' }, h('h2', {}, 'Recent orders'), tbl(['Order', 'Item', 'Buyer', 'Seller', 'Total', 'Status', ''], d.orders.map(o => h('tr', {}, td(o.number), td(o.title), td(o.buyerName), td(o.sellerName), td(usd(o.total)), td(o.status),
      td(['Placed', 'Shipped', 'Delivered'].includes(o.status) ? h('button', { class: 'link', onclick: () => { const why = prompt('Why are you refunding this order? (required, the buyer will see it)'); if (!why || why.trim().length < 5) { toast('A reason is required'); return; } act(`orders/${o.id}/refund`, 'Refunded in full', { reason: why.trim() }); } }, 'Refund in full') : (o.refundReason ? `Refunded: ${o.refundReason}` : '')))))),
    h('div', { class: 'section' }, h('h2', {}, 'Listings'), tbl(['Item', 'Seller', 'Price', 'Left', ''], d.listings.map(l => h('tr', {}, td(h('a', { href: '#/item/' + l.id }, l.title)), td(l.seller), td(usd(l.price)), td(String(l.qty)),
      td(l.removed ? 'removed' : h('button', { class: 'link', onclick: () => { if (confirm('Remove this listing?')) act(`admin/listings/${l.id}/remove`, 'Listing removed'); } }, 'Remove')))))),
    h('div', { class: 'section' }, h('h2', {}, `Newsletter signups (${d.newsletterCount})`), h('pre', { class: 'log' }, d.newsletter.map(x => x.email).join('\n') || 'None yet.')),
    h('div', { class: 'section' }, h('h2', {}, 'Payment log, newest first'), h('pre', { class: 'log' }, d.log.join('\n') || 'Nothing logged yet.')));
}

function confirmEmailPage() {
  if (me.emailVerified) { main.append(h('div', { class: 'panel done-card' }, h('div', { class: 'ok', 'aria-hidden': 'true' }, '✓'), h('h2', {}, 'Your email is confirmed'), h('a', { class: 'btn', href: '#/' }, 'Start shopping'))); return; }
  const email = h('input', { type: 'email', autocomplete: 'email', value: me.email || emailSent || '' }), msg = h('div'), err = h('p', { class: 'err' }), send = h('button', { class: 'btn' }, 'Send confirmation email');
  const sentView = (addr, dev) => {
    msg.replaceChildren(h('p', {}, `We sent a confirmation link to ${addr}. Open the email and tap the link. It works for 2 days. Look in your spam folder if you do not see it.`),
      dev ? h('p', { class: 'meta' }, 'Test mode: the email was printed in the server terminal instead of being sent.') : null);
    let n = 60; send.disabled = true; send.textContent = 'Send it again (60s)';
    const t = setInterval(() => { n -= 1; if (!send.isConnected) return clearInterval(t); send.textContent = n > 0 ? `Send it again (${n}s)` : 'Send it again'; if (n <= 0) { send.disabled = false; clearInterval(t); } }, 1000);
  };
  const refresh = async () => { try { me = (await api('me')).user; drawNav(); if (me.emailVerified) route(); else toast('Not confirmed yet. Open the link in the email first.'); } catch (x) { toast(x.message); } };
  if (emailSent) { sentView(emailSent, false); emailSent = ''; }
  main.append(h('div', { class: 'authwrap' }, h('form', { class: 'panel form-in', onsubmit: async e => {
    e.preventDefault(); err.textContent = '';
    try {
      const d = await api('verify/resend', 'POST', { email: email.value });
      if (d.already) { me.emailVerified = true; drawNav(); route(); return; }
      me.email = d.email; sentView(d.email, d.dev);
    } catch (x) { err.textContent = x.message; }
  } }, h('h2', {}, 'Confirm your email'), h('p', { class: 'meta' }, 'We email you a link. Opening it confirms your account so you can buy and sell.'),
    field('Your email', email), msg, err, send, h('div', {}, h('button', { type: 'button', class: 'link', onclick: refresh }, 'I confirmed it, check again')))));
}

// ---- Snap & Sell: photo + price + post. The server reads the photo, cleans the background and writes the listing.
let lastPosted = null;
const shrink = f => new Promise((ok, no) => {
  const img = new Image(), url = URL.createObjectURL(f);
  img.onload = () => {
    const k = Math.min(1, 1600 / Math.max(img.width, img.height)), c = document.createElement('canvas');
    c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(url); ok(c.toDataURL('image/jpeg', 0.85));
  };
  img.onerror = () => { URL.revokeObjectURL(url); no(new Error('Could not read that photo. Try a JPG or PNG.')); };
  img.src = url;
});

function snapSell() {
  let draftId = null, rawImage = null;
  const gate = h('div');
  api('connect/status').then(s => { if (s.mode === 'stripe' && !s.ready) gate.append(h('div', { class: 'panel' }, h('strong', {}, 'Set up payouts first. '), 'Connect a bank account before you post. ', h('a', { href: '#/payouts' }, 'Set up payouts'))); }, () => {});
  const file = h('input', { type: 'file', accept: 'image/*', class: 'vh', 'aria-label': 'Take or choose a photo of your item' });
  const pick = h('label', { class: 'btn snapbtn' }, 'Snap a photo', file);
  const preview = h('div', { class: 'snapprev' }), status = h('p', { class: 'meta' }), checks = h('div'), err = h('p', { class: 'err' });
  const title = h('input', { maxlength: 80 }), desc = h('textarea', { rows: 7 }), qty = h('input', { type: 'number', min: 1, max: 999, step: 1, value: 1 });
  const cat = h('select', {}, ...meta.categories.map(c => h('option', { value: c }, c))), cond = h('select', {}, ...meta.conditions.map(c => h('option', { value: c }, c)));
  cat.value = 'Everything Else';
  const price = h('input', { type: 'number', min: meta.minPrice, max: meta.maxPrice, step: 0.01, inputmode: 'decimal', placeholder: '0.00', 'aria-label': 'Your price in dollars' });
  const feeNote = h('div', { class: 'meta' }), post = h('button', { class: 'btn wide' }, 'Post it');
  price.oninput = () => { const p = Number(price.value); if (!(p > 0)) { feeNote.textContent = ''; return; } const pc = p >= meta.feeAt ? meta.feeHigh : meta.feeLow; feeNote.textContent = `Fee ${pc}%. You receive about ${usd(p * (1 - pc / 100))}.`; };
  const priceBox = h('div', { class: 'pricebox' }, field('Your price (USD)', price), feeNote), details = h('div', {}, checks, field('Title', title), field('Description', desc), h('div', { class: 'row' }, field('Category', cat), field('Condition', cond)), field('Quantity', qty));
  priceBox.hidden = details.hidden = post.hidden = true;
  const ready = text => { status.textContent = text; details.hidden = false; post.disabled = false; post.textContent = 'Post it'; };
  file.onchange = async () => {
    const f = file.files[0]; if (!f) return;
    err.textContent = ''; draftId = null; rawImage = null; details.hidden = true; checks.replaceChildren(); priceBox.hidden = post.hidden = false; post.disabled = true; post.textContent = 'Reading your photo...';
    try { rawImage = await shrink(f); } catch (x) { err.textContent = x.message; post.hidden = priceBox.hidden = true; return; }
    preview.replaceChildren(h('img', { src: rawImage, alt: 'Your photo' }));
    status.textContent = meta.snap ? 'Reading your photo and writing the listing. This takes about 10 seconds. Type your price while you wait.' : '';
    try {
      const res = await api('ai/snap', 'POST', { image: rawImage });
      if (!res.ai) return ready(res.error ? 'Our photo helper had a problem. Type the details below instead.' : 'Type the details below.');
      if (!res.draft.allowed) { status.textContent = ''; err.textContent = `Loop cannot list this item${res.draft.reason ? ': ' + res.draft.reason : ''}. See Prohibited Items in the footer.`; priceBox.hidden = post.hidden = true; return; }
      const d = res.draft; draftId = res.draftId; title.value = d.title; desc.value = d.description; cat.value = d.category; cond.value = d.condition;
      preview.replaceChildren(h('img', { src: res.image, alt: d.title || 'Your item' }));
      if (d.check.length || d.confidence !== 'high') checks.append(h('div', { class: 'checkbox' }, `Please double-check: ${d.check.length ? d.check.join(', ') : 'the title and details'}. We only name a brand or model when we can see it.`));
      ready(res.cleaned ? 'Done. We cleaned up the background and wrote your listing. Check it, add your price, and post.' : 'Done. We wrote your listing. Check it, add your price, and post.');
    } catch (x) { err.textContent = x.message; ready(''); }
  };
  const banner = lastPosted ? h('div', { class: 'panel posted' }, '✓ Posted: ', h('a', { href: '#/item/' + lastPosted.id }, lastPosted.title), '. Snap the next one.') : null; lastPosted = null;
  main.append(h('div', { class: 'snap' }, gate, banner, h('form', { class: 'panel', onsubmit: async e => {
    e.preventDefault(); err.textContent = '';
    const pr = Number(price.value);
    if (!(pr >= meta.minPrice && pr <= meta.maxPrice)) { err.textContent = `Price must be between ${usd(meta.minPrice)} and ${usd(meta.maxPrice)}.`; return; }
    if (!title.value.trim()) { err.textContent = 'Add a title.'; return; }
    post.disabled = true;
    try { lastPosted = await api('listings', 'POST', { title: title.value, description: desc.value, price: price.value, qty: qty.value, category: cat.value, condition: cond.value, ...(draftId ? { draftId } : { image: rawImage }) }); toast('Posted'); route(); }
    catch (x) { err.textContent = x.message; post.disabled = false; }
  } }, h('h2', {}, 'Snap & Sell'), h('p', { class: 'meta' }, 'Take a photo, type your price, post. We read the photo, clean the background and write the listing. You check it before it goes up.'),
    pick, preview, status, priceBox, details, err, post, h('p', { class: 'meta' }, 'Prefer to type everything yourself? ', h('a', { href: '#/sell' }, 'Use the full form'), '.'))));
}

function newsletterPage() {
  const email = h('input', { type: 'email', autocomplete: 'email', value: (me && me.email) || '' }), msg = h('p', { class: 'meta' });
  main.append(h('div', { class: 'authwrap' }, h('form', { class: 'panel', onsubmit: async e => {
    e.preventDefault();
    try { await api('newsletter', 'POST', { email: email.value }); msg.textContent = 'You are on the list. We will only email you Loop news. To stop, email us and we will remove you.'; }
    catch (x) { msg.textContent = x.message; }
  } }, h('h2', {}, 'Loop newsletter'), h('p', { class: 'meta' }, 'News about Loop, now and then.'), field('Your email', email), msg, h('button', { class: 'btn wide' }, 'Sign me up'))));
}

function accountPage() {
  const links = [['#/orders', 'Your orders'], ['#/sales', 'Your sales'], ['#/address', 'Shipping address'], ['#/payouts', 'Payouts']];
  if (!me.emailVerified) links.push(['#/confirm-email', 'Confirm your email']);
  main.append(h('div', { class: 'panel form-in' }, h('h2', {}, 'Your account'), h('p', { class: 'meta' }, `${me.username}${me.email ? ', ' + me.email : ''}${me.emailVerified ? '' : ' (email not confirmed)'}`),
    ...links.map(([href, t]) => h('div', {}, h('a', { href }, t)))));
}

function route() {
  const [v, ...a] = (location.hash.slice(2) || 'shop').split('/');
  cur = v;
  if (['sell', 'snap', 'orders', 'sales', 'address', 'payouts', 'admin', 'account', 'confirm-email', 'pay', 'paid'].includes(v) && !me) { location.hash = '#/login'; return; }
  drawNav(); main.replaceChildren(); if (!['shop', 'search', 'find'].includes(v)) qIn.value = '';
  const views = { shop: () => results(new URLSearchParams()), search: () => results(new URLSearchParams({ q: decodeURIComponent(a[0] || '') })), find: () => results(new URLSearchParams(decodeURIComponent(a[0] || ''))), advanced, login: loginView, sell, snap: snapSell, orders, sales, cart: cartView, address: addressView, payouts: payoutsPage, admin: adminPage, verify: () => verifyPage(a[0]), forgot: forgotPage, reset: () => resetPage(a[0]), 'confirm-email': confirmEmailPage, newsletter: newsletterPage, account: accountPage, pay: () => payPage(a[0]), paid: () => paidPage(a[0]), item: () => item(a[0]), user: () => user(decodeURIComponent(a[0] || '')), checkout: () => checkout(a[0], a[1]) };
  (views[v] || views.shop)();
}
addEventListener('hashchange', route);
Promise.all([api('me').then(d => { me = d.user; }, () => {}), api('meta').then(d => { meta = d; }, () => {})]).finally(route);

document.getElementById('yr').textContent = new Date().getFullYear();
