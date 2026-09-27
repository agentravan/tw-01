'use strict';
// Founder console. Every figure shown here comes from the API; nothing is computed or invented client-side.
const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inr = n => n == null ? '—' : '₹' + Number(n).toLocaleString('en-IN');
const dt = s => s ? new Date(s).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
let token = (() => { try { return localStorage.getItem('tw01_session') || ''; } catch { return ''; } })();
const setToken = t => { token = t; try { t ? localStorage.setItem('tw01_session', t) : localStorage.removeItem('tw01_session'); } catch {} };
async function api(path, opts = {}) {
  const r = await fetch(path, { ...opts, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) } });
  const d = await r.json().catch(() => ({}));
  if (r.status === 401) { setToken(''); render(); throw new Error(d.error || 'Signed out'); }
  if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
  return d;
}
const post = (p, b) => api(p, { method: 'POST', body: JSON.stringify(b || {}) });
let view = 'overview', flash = null, detailId = null;
let jarvisHistory = [];
const speak = text => { try { if ('speechSynthesis' in window) { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(text); u.rate = 1.02; u.pitch = 0.92; speechSynthesis.speak(u); } } catch {} };
const TABS = [['overview', 'Overview'], ['jarvis', 'JARVIS · EDITH'], ['orders', 'Orders'], ['objective', 'Give the AI Boss an objective'], ['cert', 'Certification'], ['products', 'Products'], ['audit', 'Audit log'], ['health', 'System health'], ['account', 'My account']];
const pillFor = s => ({ COMPLETED: 'ok', DELIVERED: 'ok', PAID: 'ok', APPROVED: 'ok', PRODUCTION_READY: 'ok', PASS: 'ok', OK: 'ok', WORKING: 'ok', IN_PRODUCTION: 'warn', QA: 'warn', TESTING: 'warn', PENDING: 'warn', AWAITING_PAYMENT: 'warn', PAYMENT_REVIEW: 'warn', REVISION: 'warn', INFO_REQUIRED: 'warn', WAITING: 'warn', IN_PROGRESS: 'warn', ASSIGNED: 'warn', REFUND_REQUESTED: 'warn', BLOCKED: 'bad', FAILED: 'bad', ESCALATED: 'bad', PAYMENT_FAILED: 'bad', REJECTED: 'bad', REFUNDED: 'bad', FAIL: 'bad', DENIED: 'bad', PAUSED: 'bad', DEGRADED: 'bad' }[s] || '');
const pill = s => `<span class="pill ${pillFor(s)}">${esc(String(s).replace(/_/g, ' '))}</span>`;
const say = (kind, text) => { flash = { kind, text }; };

async function render() {
  if (!token) return renderLogin();
  $('#tabs').hidden = false; $('#logout').hidden = false;
  $('#tabs').innerHTML = TABS.map(([k, l]) => `<button data-tab="${k}" ${view === k ? 'aria-current="page"' : ''}>${l}</button>`).join('');
  const m = $('#main');
  try {
    const me = await api('/api/co/me'); $('#who').textContent = `${me.name} · ${me.role}`;
    if (me.role !== 'FOUNDER') { m.innerHTML = '<div class="msg bad">This console is for the Founder. Customers use <a href="/portal">the portal</a>.</div>'; return; }
    const html = await VIEWS[detailId ? 'detail' : view]();
    m.innerHTML = (flash ? `<div class="msg ${flash.kind}">${esc(flash.text)}</div>` : '') + html; flash = null;
  } catch (e) { if (token) m.innerHTML = `<div class="msg bad">${esc(e.message)}</div>`; }
}
function renderLogin() {
  $('#tabs').hidden = true; $('#logout').hidden = true; $('#who').textContent = '';
  $('#main').innerHTML = `<form class="panel login" id="login"><div class="ph"><h2>Founder sign-in</h2></div><div class="pb">
    ${flash ? `<div class="msg ${flash.kind}">${esc(flash.text)}</div>` : ''}
    <label class="f" for="em">Email<input id="em" type="email" autocomplete="username" required></label>
    <label class="f" for="pw">Password<input id="pw" type="password" autocomplete="current-password" required></label>
    <button class="btn p" type="submit">Sign in</button>
    <p class="muted" style="margin:0;font-size:12.5px">The Founder account is created on first start from <span class="mono">FOUNDER_EMAIL</span> and <span class="mono">FOUNDER_PASSWORD</span>.</p></div></form>`;
  flash = null;
}

const VIEWS = {
  async jarvis() {
    const h = jarvisHistory.length ? jarvisHistory.map(x => `<div class="pb" style="border-bottom:1px solid var(--line)"><div class="row"><b>${x.who}</b><span class="muted mono">${esc(x.intent || '')}</span></div><p style="margin:6px 0">${esc(x.text)}</p>${x.plan ? `<div class="muted">Route: <b>${esc(x.plan.employee || 'none')}</b> · Executor: <b>EDITH</b> · Mode: ${esc(x.plan.mode)}</div><div class="muted">${x.plan.steps.map(esc).join(' → ')}</div>` : ''}</div>`).join('') : '<div class="pb muted">No commands yet. Try: “Run a security scan”, “Give me the revenue report”, “Test the workforce”, or “Check product management”.';
    return `<h1>JARVIS · Founder AI</h1><p class="muted">JARVIS plans and routes. EDITH executes only through verified TW-01 capabilities and refuses to claim work without evidence.</p>
      <div class="panel" style="border-color:var(--accent,#888)"><div class="pb">
        <form id="jarvis-form"><div class="row"><input id="jarvis-text" autocomplete="off" placeholder="Talk to JARVIS… e.g. “Run a security scan”" style="flex:1 1 420px"><button class="btn p" type="submit">Execute</button><button class="btn" type="button" id="jarvis-mic">🎙 Speak</button></div></form>
        <div class="muted" style="margin-top:8px;font-size:12px">Voice uses the browser Web Speech API when supported. Text mode always works.</div>
      </div></div>
      <div class="panel"><div class="ph"><h2>Command history</h2><span class="r muted">Founder-controlled</span></div>${h}</div>`;
  },
  async account() {
    return `<h1>My account</h1><form class="panel" id="pwform" style="max-width:420px"><div class="pb" style="display:flex;flex-direction:column;gap:10px"><label class="f" for="pw-cur">Current password<input id="pw-cur" type="password" autocomplete="current-password" required></label><label class="f" for="pw-new">New password (10+ characters)<input id="pw-new" type="password" autocomplete="new-password" required></label><button class="btn p" type="submit">Change password</button><p class="muted" style="margin:0;font-size:12.5px">Other devices signed in to this account will be signed out.</p></div></form>`;
  },
  async overview() {
    const o = await api('/api/co/admin/overview'); const t = o.metrics.totals, p = o.metrics.pipeline;
    $('#gw').textContent = `Razorpay ${o.gateway.razorpay} · Webhook ${o.gateway.webhook} · Email ${o.gateway.smtp}`;
    const card = (l, v, s) => `<div class="card"><span>${l}</span><b>${v}</b><small>${s}</small></div>`;
    return `<h1>Command center</h1><p class="muted">All figures are computed from recorded orders, verified payments and tasks.</p>
    <div class="cards">${card('Revenue', inr(t.revenue), `today ${inr(o.metrics.today.revenue)} · refunds ${inr(t.refunds)}`)}${card('Orders', t.orders, `today ${o.metrics.today.orders}`)}${card('Customers', t.customers, 'registered')}${card('Leads', t.leads, 'in the sales CRM')}${card('Conversion', t.conversionPct == null ? '—' : t.conversionPct + '%', 'paid ÷ orders')}${card('Profit', '—', esc(t.profitNote))}${card('Pending payments', t.pendingPayments, 'awaiting / failed / review')}</div>
    <div class="panel"><div class="ph"><h2>Dashboard business pipeline</h2></div><div class="tw"><table><thead><tr>${['Paid', 'Pending', 'Production', 'QA', 'Delivered', 'Revision', 'Refund'].map(x => `<th>${x}</th>`).join('')}</tr></thead><tbody><tr>${['paid', 'pending', 'production', 'qa', 'delivered', 'revision', 'refund'].map(k => `<td class="n" style="text-align:left;font-size:18px">${p[k]}</td>`).join('')}</tr></tbody></table></div></div>
    <div class="panel"><div class="ph"><h2>Waiting for your decision</h2><span class="r pill ${o.approvals.length ? 'warn' : 'ok'}">${o.approvals.length}</span></div>${o.approvals.length ? o.approvals.map(a => `<div class="pb" style="border-bottom:1px solid var(--line)"><div class="row">${pill(a.tier)}<b>${esc(a.action)}</b><span class="mono muted">${esc(a.entityId)} · ${a.id}</span></div><p style="margin:6px 0">${esc(a.summary)}</p><p class="muted" style="margin:0 0 8px">Why: ${esc(a.reason)} · requested by ${esc(a.requestedBy)} ${dt(a.requestedAt)}</p>
      <div class="row"><button class="btn p" data-approve="${a.id}">Approve</button><input id="rj-${a.id}" placeholder="Reason for rejecting (recorded)" style="flex:1 1 220px"><button class="btn d" data-reject="${a.id}">Reject</button></div></div>`).join('') : '<div class="pb muted">Nothing needs approval.</div>'}</div>
    <div class="panel"><div class="ph"><h2>AI workforce</h2><span class="r muted">Status comes from recorded test runs and real task/tool activity</span></div><div class="tw"><table><thead><tr><th>Employee</th><th>Certification</th><th>Now</th><th>Task</th><th>Current tool</th><th>Last event</th><th>Evidence</th><th></th></tr></thead><tbody>
    ${o.workforce.map(w => `<tr><td><b>${esc(w.employee)}</b><div class="muted mono">${esc(w.role)} v${esc(w.version)}</div></td><td>${pill(w.status)}</td><td>${pill(w.activity.state)}</td><td>${esc(w.activity.task || '—')}${w.activity.taskStatus ? '<br>' + pill(w.activity.taskStatus) : ''}</td><td class="mono">${esc(w.activity.currentTool || '—')}</td><td>${esc(w.activity.lastEvent || '—')}${w.activity.lastEventAt ? `<div class="muted">${dt(w.activity.lastEventAt)}</div>` : ''}</td><td class="mono">${esc(w.activity.evidence || '—')}</td>
      <td>${w.implemented ? `<button class="btn" data-pause="${w.role}" data-paused="${w.paused}">${w.paused ? 'Resume' : 'Pause'}</button>` : '<span class="muted">not built</span>'}</td></tr>`).join('')}</tbody></table></div></div>`;
  },
  async orders() {
    const o = await api('/api/co/admin/overview');
    return `<h1>Dashboard orders</h1><div class="panel"><div class="tw"><table><thead><tr><th>Order</th><th>Customer</th><th>Product</th><th>Amount</th><th>Status</th><th>Production gate</th><th>Updated</th></tr></thead><tbody>
    ${o.orders.map(x => `<tr><td><a href="#" data-open="${x.id}" class="mono">${x.id}</a></td><td>${esc(x.customer)}</td><td>${esc(x.product)}</td><td class="n">${inr(x.amount)}</td><td>${pill(x.status)}</td><td>${x.gate.ok ? `<span class="ok">open</span> <span class="muted">(${esc(x.gate.basis)})</span>` : '<span class="bad">locked</span>'}</td><td>${dt(x.updatedAt)}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">No orders yet.</td></tr>'}</tbody></table></div></div>`;
  },
  async detail() {
    const d = await api('/api/co/admin/orders/' + detailId); const o = d.order;
    const unpaid = ['AWAITING_PAYMENT', 'PAYMENT_FAILED', 'PAYMENT_REVIEW'].includes(o.status);
    return `<p><a href="#" data-back>← All orders</a></p><h1>${esc(o.id)} · ${esc(d.customer.company)}</h1><p class="muted">${esc(o.productName)} · ${inr(o.amount)} · ${pill(o.status)} · created ${dt(o.createdAt)}</p>
    <div class="msg ${d.gate.ok ? 'ok' : 'bad'}"><b>Production gate ${d.gate.ok ? 'open' : 'locked'}:</b> ${esc(d.gate.reason)}</div>
    <div class="row" style="margin-bottom:16px"><button class="btn p" data-run="${o.id}">Run pipeline now</button>
      ${unpaid ? `<input id="ov-reason" placeholder="Why start before payment? (min 10 chars)" style="flex:1 1 260px"><button class="btn" data-override="${o.id}">Request override (🔴)</button>` : ''}
      ${o.paymentVerified && !['REFUNDED', 'REFUND_REQUESTED'].includes(o.status) ? `<input id="rf-reason" placeholder="Refund reason" style="flex:1 1 200px"><input id="rf-amt" type="number" placeholder="Amount (blank = full)" style="width:160px"><button class="btn d" data-refund="${o.id}">Request refund</button>` : ''}</div>
    <div class="grid2"><div>
      <div class="panel"><div class="ph"><h2>Tasks</h2></div><div class="tw"><table><thead><tr><th>Task</th><th>Status</th><th>Evidence</th></tr></thead><tbody>${d.tasks.map(t => `<tr><td>${esc(t.title)}<div class="muted mono">${t.agent} · retry ${t.retryCount}/${t.maxRetries}${t.qaBy ? ' · QA ' + esc(t.qaBy) : ''}</div>${t.errors.length ? `<div class="bad">${esc(t.errors.at(-1))}</div>` : ''}</td><td>${pill(t.status)}</td><td class="mono">${t.evidence.map(e => esc(e.kind + ':' + e.ref)).join('<br>') || '—'}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">No tasks (payment not verified and no override).</td></tr>'}</tbody></table></div></div>
      <div class="panel"><div class="ph"><h2>Payments</h2></div><div class="tw"><table><thead><tr><th>Source</th><th>Payment</th><th>Gateway</th><th>Verified</th></tr></thead><tbody>${d.payments.map(p => `<tr><td>${p.source}</td><td class="mono">${esc(p.razorpay_payment_id || '—')}</td><td>${esc(p.gatewayStatus || '—')} ${p.amountPaise != null ? inr(p.amountPaise / 100) : ''}</td><td>${p.verified ? '<span class="ok">yes</span>' : `<span class="bad">no</span> <span class="muted">${esc(p.failureReason || '')}</span>`}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">No payment attempts.</td></tr>'}</tbody></table></div></div>
      <div class="panel"><div class="ph"><h2>QA reports</h2></div>${d.qa.map(q => `<div class="pb">${pill(q.passed ? 'PASS' : 'FAIL')} <span class="mono">${q.id}</span> · ${q.checks.filter(c => c.passed).length}/${q.checks.length} checks<details><summary>Checks</summary><pre>${q.checks.map(c => `${c.passed ? '✓' : '✗'} ${c.name} — ${c.detail}`).map(esc).join('\n')}</pre></details></div>`).join('') || '<div class="pb muted">No QA yet.</div>'}</div>
    </div><div>
      <div class="panel"><div class="ph"><h2>Requirement</h2></div><div class="pb"><pre>${esc(JSON.stringify(o.requirement, null, 2))}</pre><p class="muted">Files: ${o.files.map(f => esc(`${f.name} (${f.bytes} B)`)).join(', ') || 'none'}</p>${o.deliverables.buildId ? `<p><a href="#" data-dl="${o.id}|dashboard">Download dashboard</a> · <a href="#" data-dl="${o.id}|guide">Download guide</a></p>` : ''}</div></div>
      <div class="panel"><div class="ph"><h2>Emails</h2></div><div class="tw"><table><tbody>${d.emails.map(e => `<tr><td>${esc(e.template)}</td><td>${pill(e.status)}</td><td>${dt(e.at)}</td></tr>`).join('') || '<tr><td class="muted">None</td></tr>'}</tbody></table></div></div>
      <div class="panel"><div class="ph"><h2>Audit trail</h2></div><div class="pb"><pre>${d.audit.slice().reverse().map(a => `#${a.seq} ${a.at.slice(11, 19)} ${a.who} ${a.what} ${a.result}${a.detail ? ' — ' + a.detail : ''}`).map(esc).join('\n')}</pre></div></div>
    </div></div>`;
  },
  async objective() {
    const tasks = (await api('/api/co/admin/overview')).tasks.filter(t => t.createdBy === 'agent:ai-boss' && !t.orderId).slice(0, 15);
    return `<h1>Give the AI Boss an objective</h1><p class="muted">Routing is rule-based and shown openly. Objectives for employees that are not built yet are escalated back to you, not faked.</p>
    <form class="panel" id="obj"><div class="pb"><textarea id="objtext" placeholder="e.g. Run a security scan · Give me the revenue report · Continue work on ORD-1001 · Run tests on the workforce"></textarea><div class="row" style="margin-top:8px"><button class="btn p" type="submit">Send to AI Boss</button></div></div></form>
    <div class="panel"><div class="ph"><h2>Recent objectives</h2></div><div class="tw"><table><thead><tr><th>Objective</th><th>Assigned to</th><th>Status</th><th>Evidence</th><th>Notes</th></tr></thead><tbody>${tasks.map(t => `<tr><td>${esc(t.title)}</td><td class="mono">${t.agent}</td><td>${pill(t.status)}</td><td class="mono">${t.evidence.map(e => esc(e.kind + ':' + e.ref)).join('<br>') || '—'}</td><td>${esc(t.errors.at(-1) || '')}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">None yet.</td></tr>'}</tbody></table></div></div>`;
  },
  async cert() {
    const cs = await api('/api/co/admin/certifications'); const LV = ['UNIT', 'INTEGRATION', 'FUNCTIONAL', 'FAILURE', 'SECURITY', 'REGRESSION', 'PRODUCTION'];
    return `<h1>AI employee certification</h1><p class="muted">A level shows PASS only when a recorded run passed every scenario at that level. PRODUCTION needs a run against the deployed system and is never set locally.</p>
    <div class="row" style="margin-bottom:12px"><button class="btn p" id="certify">Run all self-tests now</button><span class="muted">Runs every scenario in isolated sandboxes; takes about a minute.</span></div>
    <div class="panel"><div class="tw"><table><thead><tr><th>Employee</th>${LV.map(l => `<th>${l.slice(0, 5)}</th>`).join('')}<th>Status</th><th>Last verified</th></tr></thead><tbody>${cs.map(c => `<tr><td><b>${esc(c.employee)}</b><div class="muted mono">v${esc(c.version)}</div></td>${LV.map(l => `<td><span class="lvl ${c.levels[l].result}">${c.levels[l].result.replace('_', ' ')}</span>${c.levels[l].failed ? `<div class="bad">${c.levels[l].failed} failed</div>` : ''}</td>`).join('')}<td>${pill(c.status)}</td><td>${dt(c.lastVerified)}</td></tr>`).join('')}</tbody></table></div></div>`;
  },
  async products() {
    const ps = await api('/api/co/admin/list/products');
    return `<h1>Products</h1><p class="muted">Products start inactive with no price. Set a price, then activate. Products without a build engine cannot be activated.</p><div class="panel"><div class="tw"><table><thead><tr><th>Product</th><th>Builder</th><th>Price (₹)</th><th>SLA (days)</th><th>Active</th><th></th></tr></thead><tbody>
    ${ps.map(p => `<tr><td><b>${esc(p.name)}</b><div class="muted">${esc(p.kpis.join(', ') || '—')}</div></td><td class="mono">${esc(p.builder || 'not built')}</td><td><input id="pr-${p.id}" type="number" min="1" value="${p.price ?? ''}" style="width:110px"></td><td><input id="sla-${p.id}" type="number" min="1" max="60" value="${p.slaDays}" style="width:70px"></td><td><input id="ac-${p.id}" type="checkbox" ${p.active ? 'checked' : ''} ${p.builder ? '' : 'disabled'}></td><td><button class="btn" data-save="${p.id}">Save</button></td></tr>`).join('')}</tbody></table></div></div>`;
  },
  async audit() {
    const a = await api('/api/co/admin/list/audit');
    return `<h1>Audit log</h1><div class="msg ${a.chain.ok ? 'ok' : 'bad'}">Hash chain ${a.chain.ok ? `intact (${a.chain.checked} entries verified)` : `BROKEN at #${a.chain.brokenAt}: ${esc(a.chain.reason)}`}</div>
    <div class="panel"><div class="tw"><table><thead><tr><th>#</th><th>When</th><th>Who</th><th>What</th><th>Result</th><th>Entity</th><th>Detail</th></tr></thead><tbody>${a.entries.slice(0, 300).map(e => `<tr><td class="mono">${e.seq}</td><td>${dt(e.at)}</td><td class="mono">${esc(e.who)}</td><td>${esc(e.what)}</td><td>${pill(e.result)}</td><td class="mono">${esc(e.entityId || '')}</td><td>${esc(e.detail)}${e.approvalId ? ` <span class="mono">(${e.approvalId})</span>` : ''}</td></tr>`).join('')}</tbody></table></div></div>`;
  },
  async health() {
    const h = await api('/api/co/health'); const f = await api('/api/co/admin/security');
    return `<h1>System health</h1><div class="cards"><div class="card"><span>Status</span><b>${pill(h.status)}</b></div><div class="card"><span>Store</span><b style="font-size:14px">${esc(h.store.kind)}</b><small>${h.store.durableOnServerless ? '' : 'not durable on serverless hosts'}</small></div><div class="card"><span>Razorpay</span><b style="font-size:14px">${esc(h.integrations.razorpay)}</b><small>webhook ${esc(h.integrations.razorpayWebhook)}</small></div><div class="card"><span>Email</span><b style="font-size:14px">${esc(h.integrations.smtp)}</b></div><div class="card"><span>Escalated tasks</span><b>${h.counts.escalated}</b></div><div class="card"><span>Failed tool runs (24h)</span><b>${h.counts.failedToolExecutions24h}</b></div></div>
    <div class="panel"><div class="ph"><h2>Security checks</h2><span class="r muted">Ask the AI Boss to “run a security scan” to record one as a task</span></div><div class="tw"><table><tbody>${f.map(x => `<tr><td>${x.ok ? '<span class="ok">✓</span>' : '<span class="bad">✗</span>'}</td><td class="mono">${esc(x.check)}</td><td>${pill(x.severity)}</td><td>${esc(x.detail)}</td></tr>`).join('')}</tbody></table></div></div>
    <div class="panel"><div class="ph"><h2>Tools</h2></div><div class="tw"><table><tbody>${h.tools.map(t => `<tr><td class="mono">${esc(t.name)}</td><td>${pill(t.status)}</td><td>${esc(t.lastTest?.detail || '')}</td><td>${dt(t.lastTest?.at)}</td></tr>`).join('')}</tbody></table></div></div>`;
  },
};

document.addEventListener('click', async e => {
  const b = e.target.closest('button, a'); if (!b) return;
  try {
    if (b.dataset.tab) { view = b.dataset.tab; detailId = null; return render(); }
    if (b.id === 'jarvis-mic') {
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SR) { say('bad', 'Speech recognition is not available in this browser. Use text mode.'); return render(); }
      const r = new SR(); r.lang = 'en-IN'; r.interimResults = false; r.maxAlternatives = 1;
      r.onresult = ev => { const text = ev.results?.[0]?.[0]?.transcript || ''; if (text) { $('#jarvis-text').value = text; $('#jarvis-form').requestSubmit(); } };
      r.onerror = () => { say('bad', 'Microphone recognition failed. Check browser microphone permission.'); render(); };
      r.start(); say('ok', 'Listening…'); render(); return;
    }
    if (b.dataset.open) { e.preventDefault(); detailId = b.dataset.open; return render(); }
    if (b.hasAttribute('data-back')) { e.preventDefault(); detailId = null; view = 'orders'; return render(); }
    if (b.id === 'logout') { await post('/api/co/auth/logout').catch(() => {}); setToken(''); return render(); }
    if (b.dataset.approve) { b.disabled = true; await post('/api/co/admin/approvals/' + b.dataset.approve, { decision: 'approve' }); say('ok', 'Approved and recorded.'); return render(); }
    if (b.dataset.reject) { const r = $('#rj-' + b.dataset.reject).value; await post('/api/co/admin/approvals/' + b.dataset.reject, { decision: 'reject', reason: r }); say('ok', 'Rejected. The action stays blocked.'); return render(); }
    if (b.dataset.pause) { await post(`/api/co/admin/agents/${b.dataset.pause}/pause`, { paused: b.dataset.paused !== 'true' }); return render(); }
    if (b.dataset.run) { b.disabled = true; const r = await post(`/api/co/admin/orders/${b.dataset.run}/run`); say(r.log.some(l => /fail|blocked/i.test(l)) ? 'bad' : 'ok', `Pipeline: ${r.status}. ${r.log.join(' · ')}`); return render(); }
    if (b.dataset.override) { await post(`/api/co/admin/orders/${b.dataset.override}/override`, { reason: $('#ov-reason').value }); say('ok', 'Override requested. Approve it on the Overview tab to unlock production.'); return render(); }
    if (b.dataset.refund) { const amt = $('#rf-amt').value; await post(`/api/co/admin/orders/${b.dataset.refund}/refund`, { reason: $('#rf-reason').value, amount: amt || undefined }); say('ok', 'Refund sent for approval.'); return render(); }
    if (b.dataset.save) { const id = b.dataset.save; const price = $('#pr-' + id).value; await post('/api/co/admin/products/' + id, { price: price || undefined, slaDays: $('#sla-' + id).value, active: $('#ac-' + id).checked }); say('ok', 'Saved.'); return render(); }
    if (b.dataset.dl) { e.preventDefault(); const [id, w] = b.dataset.dl.split('|'); const r = await fetch(`/api/co/orders/${id}/download/${w}`, { headers: { authorization: 'Bearer ' + token } }); if (!r.ok) throw new Error('Download failed'); const a = document.createElement('a'); a.href = URL.createObjectURL(await r.blob()); a.download = `${id}-${w}.html`; a.click(); return; }
    if (b.id === 'certify') { b.disabled = true; b.textContent = 'Running…'; const r = await post('/api/co/admin/certify'); say(r.failed ? 'bad' : 'ok', `Recorded run ${r.runId}: ${r.passed} passed, ${r.failed} failed.`); return render(); }
  } catch (err) { say('bad', err.message); render(); }
});
document.addEventListener('submit', async e => {
  e.preventDefault();
  try {
    if (e.target.id === 'login') { const r = await post('/api/co/auth/login', { email: $('#em').value, password: $('#pw').value }); setToken(r.token); view = 'overview'; return render(); }
    if (e.target.id === 'pwform') { await post('/api/co/auth/password', { current: $('#pw-cur').value, next: $('#pw-new').value }); say('ok', 'Password changed. Other sessions were signed out.'); return render(); }
    if (e.target.id === 'obj') { const t = await post('/api/co/admin/objective', { text: $('#objtext').value }); say(t.status === 'COMPLETED' ? 'ok' : 'bad', `Task ${t.id} → ${t.agent}: ${t.status}${t.errors.length ? ' — ' + t.errors.at(-1) : ''}`); return render(); }
    if (e.target.id === 'jarvis-form') {
      const text = $('#jarvis-text').value.trim(); if (!text) return;
      const r = await post('/api/co/admin/jarvis', { text });
      jarvisHistory.unshift({ who: 'JARVIS', text: r.response, intent: r.plan.intent, plan: r.plan });
      speak(r.response); say(r.task?.status === 'COMPLETED' ? 'ok' : 'warn', r.response); return render();
    }
  } catch (err) { say('bad', err.message); render(); }
});
render();
