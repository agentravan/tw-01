'use strict';
// Customer portal: products, requirement form, file upload, Razorpay Checkout, order status, downloads, revisions.
// Customers only ever see customer-facing statuses; internal AI operations are not exposed by the API.
const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inr = n => '₹' + Number(n).toLocaleString('en-IN');
const dt = s => s ? new Date(s).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
let token = (() => { try { return localStorage.getItem('tw01_customer') || ''; } catch { return ''; } })();
const setToken = t => { token = t; try { t ? localStorage.setItem('tw01_customer', t) : localStorage.removeItem('tw01_customer'); } catch {} };
async function api(path, opts = {}) {
  const r = await fetch(path, { ...opts, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) } });
  const d = await r.json().catch(() => ({}));
  if (r.status === 401 && token) { setToken(''); }
  if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
  return d;
}
const post = (p, b) => api(p, { method: 'POST', body: JSON.stringify(b || {}) });
let view = { name: 'home' }, flash = null;
const say = (k, t) => { flash = { kind: k, text: t }; };

async function render() {
  const m = $('#main'); $('#logout').hidden = !token;
  try {
    const html = token ? await (view.name === 'order' ? orderView(view.id) : view.name === 'new' ? newOrderView(view.productId) : homeView()) : await signInView();
    m.innerHTML = (flash ? `<div class="msg ${flash.kind}">${esc(flash.text)}</div>` : '') + html; flash = null;
  } catch (e) { m.innerHTML = `<div class="msg bad">${esc(e.message)}</div>`; }
}
async function signInView() {
  $('#who').textContent = '';
  const products = await api('/api/co/products');
  return `<h1>HR dashboards built from your employee data</h1><p class="muted">Upload your employee master, pay online, and receive a tested dashboard with a guide book.</p>
  <div class="panel"><div class="ph"><h2>Available dashboards</h2></div><div class="tw"><table><tbody>${products.map(p => `<tr><td><b>${esc(p.name)}</b><div class="muted">${esc(p.kpis.length)} KPIs · delivered in about ${p.slaDays} working days</div></td><td class="n">${inr(p.price)}</td></tr>`).join('') || '<tr><td class="muted">No dashboards are on sale yet.</td></tr>'}</tbody></table></div></div>
  <div class="grid2"><form class="panel" id="login"><div class="ph"><h2>Sign in</h2></div><div class="pb" style="display:flex;flex-direction:column;gap:10px">
    <label class="f" for="l-em">Email<input id="l-em" type="email" autocomplete="username" required></label><label class="f" for="l-pw">Password<input id="l-pw" type="password" autocomplete="current-password" required></label><button class="btn p" type="submit">Sign in</button></div></form>
  <form class="panel" id="register"><div class="ph"><h2>Create an account</h2></div><div class="pb" style="display:flex;flex-direction:column;gap:10px">
    <label class="f" for="r-name">Your name<input id="r-name" required></label><label class="f" for="r-co">Company<input id="r-co" required></label>
    <label class="f" for="r-em">Work email<input id="r-em" type="email" required></label><label class="f" for="r-mob">Mobile<input id="r-mob" inputmode="tel" placeholder="98xxxxxxxx" required></label>
    <label class="f" for="r-pw">Password (10+ characters)<input id="r-pw" type="password" autocomplete="new-password" required></label><button class="btn p" type="submit">Create account</button></div></form></div>`;
}
async function homeView() {
  const [me, products, orders] = await Promise.all([api('/api/co/me'), api('/api/co/products'), api('/api/co/orders')]);
  $('#who').textContent = me.name;
  return `<h1>Your dashboard orders</h1>
  <div class="panel"><div class="tw"><table><thead><tr><th>Order</th><th>Dashboard</th><th>Amount</th><th>Status</th><th>Updated</th></tr></thead><tbody>${orders.map(o => `<tr><td><a href="#" data-order="${o.id}" class="mono">${o.id}</a></td><td>${esc(o.product)}</td><td class="n">${inr(o.amount)}</td><td>${esc(o.status)}</td><td>${dt(o.updatedAt)}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">No orders yet.</td></tr>'}</tbody></table></div></div>
  <div class="panel"><div class="ph"><h2>Order a dashboard</h2></div><div class="tw"><table><tbody>${products.map(p => `<tr><td><b>${esc(p.name)}</b><div class="muted">Needs: ${esc(p.requiredFiles.map(f => f.name).join(', '))}</div></td><td class="n">${inr(p.price)}</td><td><button class="btn p" data-new="${p.id}">Order</button></td></tr>`).join('') || '<tr><td class="muted">No dashboards are on sale yet.</td></tr>'}</tbody></table></div></div>`;
}
async function newOrderView(productId) {
  const p = (await api('/api/co/products')).find(x => x.id === productId); if (!p) throw new Error('Product not available.');
  const d = new Date(); d.setDate(d.getDate() + p.slaDays + 2);
  return `<p><a href="#" data-home>← Back</a></p><h1>Dashboard Requirement Form</h1><p class="muted">${esc(p.name)} · ${inr(p.price)}</p>
  <form class="panel" id="order"><div class="pb grid2">
    <label class="f" for="o-co">Company<input id="o-co" required></label><label class="f" for="o-n">Number of employees<input id="o-n" type="number" min="1" required></label>
    <label class="f" for="o-src">Data source (e.g. Zoho People, Keka, Excel)<input id="o-src" required></label><label class="f" for="o-fmt">Required format<select id="o-fmt"><option>HTML dashboard</option></select></label>
    <label class="f" for="o-dl">Deadline<input id="o-dl" type="date" value="${d.toISOString().slice(0, 10)}" required></label><label class="f" for="o-file">Employee master (.csv)<input id="o-file" type="file" accept=".csv,text/csv"></label>
    <label class="f" style="grid-column:1/-1" for="o-add">Additional requirements<textarea id="o-add"></textarea></label>
    <p class="muted" style="grid-column:1/-1;margin:0">Required columns: ${esc(p.requiredFiles[0]?.columns.join(', ') || '')}. You can also upload the file later.</p>
    <div style="grid-column:1/-1"><button class="btn p" type="submit">Place order</button></div></div><input type="hidden" id="o-pid" value="${esc(p.id)}"></form>`;
}
async function orderView(id) {
  const o = await api('/api/co/orders/' + id);
  return `<p><a href="#" data-home>← Your orders</a></p><h1>${esc(o.id)} · ${esc(o.product)}</h1><p class="muted">${inr(o.amount)} · placed ${dt(o.createdAt)}</p>
  <div class="msg"><b>Status:</b> ${esc(o.status)}</div>
  ${o.canPay ? `<div class="panel"><div class="ph"><h2>Payment</h2></div><div class="pb">${o.paymentConfigured ? `<button class="btn p" data-pay="${o.id}">Pay ${inr(o.amount)} online</button>` : '<p class="muted" style="margin:0">Online payment is not available yet. We will contact you.</p>'}
     <details style="margin-top:12px"><summary>Already paid? Give us your Razorpay payment id</summary><form id="claim" class="row" style="margin-top:8px"><input id="c-pid" placeholder="pay_XXXXXXXXXXXXXX" style="flex:1 1 220px"><button class="btn" type="submit">Check payment</button></form><p class="muted" style="font-size:12.5px">We confirm every payment directly with Razorpay. Screenshots cannot be used as proof.</p></details></div></div>` : ''}
  ${o.deliverables.dashboard ? `<div class="panel"><div class="ph"><h2>Your dashboard</h2></div><div class="pb row"><button class="btn p" data-dl="${o.id}|dashboard">Download dashboard</button><button class="btn" data-dl="${o.id}|guide">Download guide book</button></div></div>` : ''}
  <div class="grid2"><div class="panel"><div class="ph"><h2>Your data file</h2></div><div class="pb">${o.files.map(f => `<div>${esc(f.name)} <span class="muted">${f.bytes.toLocaleString('en-IN')} bytes · ${dt(f.uploadedAt)}</span></div>`).join('') || '<p class="muted">No file uploaded yet.</p>'}
    <form id="upload" class="row" style="margin-top:10px"><input id="u-file" type="file" accept=".csv,text/csv"><button class="btn" type="submit">Upload</button></form></div></div>
  <div class="panel"><div class="ph"><h2>History</h2></div><div class="pb">${o.timeline.slice().reverse().map(t => `<div><span class="muted">${dt(t.at)}</span> — ${esc(t.status)}</div>`).join('')}</div></div></div>
  ${o.canRevise ? `<form class="panel" id="revision"><div class="ph"><h2>Request a change</h2></div><div class="pb"><textarea id="rv" placeholder="Describe what should change. Upload a new file above first if your data changed."></textarea><button class="btn" type="submit" style="margin-top:8px">Send revision request</button></div></form>` : ''}
  ${o.payments.length ? `<div class="panel"><div class="ph"><h2>Payments</h2></div><div class="tw"><table><tbody>${o.payments.map(p => `<tr><td>${dt(p.at)}</td><td class="mono">${esc(p.paymentId || '')}</td><td>${esc(p.status)}</td><td class="muted">${esc(p.note || '')}</td></tr>`).join('')}</tbody></table></div></div>` : ''}`;
}
const readFileText = f => new Promise((ok, no) => { if (f.size > 5 * 1024 * 1024) return no(new Error('File must be 5 MB or smaller.')); const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = () => no(new Error('Could not read the file.')); r.readAsText(f); });
function loadCheckout() { return window.Razorpay ? Promise.resolve() : new Promise((ok, no) => { const s = document.createElement('script'); s.src = 'https://checkout.razorpay.com/v1/checkout.js'; s.onload = ok; s.onerror = () => no(new Error('Could not load Razorpay Checkout.')); document.head.appendChild(s); }); }
async function pay(id) {
  const o = await api('/api/co/orders/' + id);
  let gatewayOrderId = o.gatewayOrderId; let key = o.razorpayKeyId;
  if (!gatewayOrderId || o.statusCode === 'PAYMENT_FAILED') { const r = await post(`/api/co/orders/${id}/checkout/retry`); if (r.checkout.status !== 'READY') throw new Error(r.checkout.message); gatewayOrderId = r.checkout.gatewayOrderId; key = r.checkout.keyId; }
  await loadCheckout();
  await new Promise((resolve, reject) => {
    const rz = new window.Razorpay({ key, order_id: gatewayOrderId, amount: Math.round(o.amount * 100), currency: 'INR', name: 'Team Work Solutions', description: `${o.product} · ${o.id}`,
      handler: async resp => { try { const r = await post(`/api/co/orders/${id}/checkout/confirm`, resp); say(r.verified ? 'ok' : 'bad', r.verified ? 'Payment verified. Work on your dashboard has started.' : 'We could not verify this payment: ' + (r.problems || []).join('; ')); resolve(); } catch (e) { reject(e); } },
      modal: { ondismiss: () => resolve() } });
    rz.on('payment.failed', r => { say('bad', 'Payment failed: ' + (r.error?.description || 'unknown reason') + '. You can try again.'); resolve(); });
    rz.open();
  });
}
document.addEventListener('click', async e => {
  const b = e.target.closest('button,a'); if (!b) return;
  try {
    if (b.id === 'logout') { await post('/api/co/auth/logout').catch(() => {}); setToken(''); view = { name: 'home' }; return render(); }
    if (b.dataset.new) { view = { name: 'new', productId: b.dataset.new }; return render(); }
    if (b.dataset.order) { e.preventDefault(); view = { name: 'order', id: b.dataset.order }; return render(); }
    if (b.hasAttribute('data-home')) { e.preventDefault(); view = { name: 'home' }; return render(); }
    if (b.dataset.pay) { b.disabled = true; await pay(b.dataset.pay); return render(); }
    if (b.dataset.dl) { const [id, w] = b.dataset.dl.split('|'); const r = await fetch(`/api/co/orders/${id}/download/${w}`, { headers: { authorization: 'Bearer ' + token } }); if (!r.ok) throw new Error('Download failed.'); const a = document.createElement('a'); a.href = URL.createObjectURL(await r.blob()); a.download = `${id}-${w}.html`; a.click(); }
  } catch (err) { say('bad', err.message); render(); }
});
document.addEventListener('submit', async e => {
  e.preventDefault(); const f = e.target;
  try {
    if (f.id === 'login') { const r = await post('/api/co/auth/login', { email: $('#l-em').value, password: $('#l-pw').value }); setToken(r.token); return render(); }
    if (f.id === 'register') { const r = await post('/api/co/auth/register', { name: $('#r-name').value, company: $('#r-co').value, email: $('#r-em').value, mobile: $('#r-mob').value, password: $('#r-pw').value }); setToken(r.token); return render(); }
    if (f.id === 'order') {
      const file = $('#o-file').files[0]; const content = file ? await readFileText(file) : null;
      const r = await post('/api/co/orders', { productId: $('#o-pid').value, company: $('#o-co').value, employeeCount: $('#o-n').value, dataSource: $('#o-src').value, requiredFormat: $('#o-fmt').value, deadline: $('#o-dl').value, additional: $('#o-add').value });
      if (content) await post(`/api/co/orders/${r.order.id}/files`, { name: file.name, content });
      say('ok', `Order ${r.order.id} placed.` + (r.checkout.status === 'READY' ? ' Pay below to start work.' : ' ' + r.checkout.message));
      view = { name: 'order', id: r.order.id }; return render();
    }
    if (f.id === 'upload') { const file = $('#u-file').files[0]; if (!file) throw new Error('Choose a .csv file first.'); await post(`/api/co/orders/${view.id}/files`, { name: file.name, content: await readFileText(file) }); say('ok', 'File uploaded.'); return render(); }
    if (f.id === 'claim') { const r = await post(`/api/co/orders/${view.id}/claim`, { paymentId: $('#c-pid').value }); say(r.status === 'VERIFIED' ? 'ok' : 'bad', r.status === 'VERIFIED' ? 'Payment confirmed with Razorpay.' : r.note); return render(); }
    if (f.id === 'revision') { await post(`/api/co/orders/${view.id}/revision`, { note: $('#rv').value }); say('ok', 'Revision request received.'); return render(); }
  } catch (err) { say('bad', err.message); render(); }
});
render();
