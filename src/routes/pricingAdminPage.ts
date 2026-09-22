// The admin page: one self-contained HTML document, DOM built in vanilla
// JS from GET /admin/pricing/deals. Design follows the 2026 guidance for
// dense operational UIs: visible grid, ledger-style monospaced numerals,
// fluid type via clamp(), motion only where it communicates state, and
// honoured prefers-reduced-motion plus a manual toggle. No blur, no glass.
export const pricingAdminHtml = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Renewal Billing — VA Pipeline</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  :root {
    --bg: #f4f5f7; --surface: #ffffff; --surface-2: #fafbfc;
    --line: #e3e6ea; --line-strong: #c9ced6;
    --ink: #111827; --ink-2: #374151; --muted: #6b7280;
    --accent: #2457e6; --accent-hover: #1d4ac9;
    --green: #15803d; --green-bg: #e6f5eb;
    --amber: #b45309; --amber-bg: #fdf1df;
    --red: #b91c1c; --red-bg: #fde7e7;
    --blue: #1d4ed8; --blue-bg: #e3ebfb;
    --indigo: #4338ca; --indigo-bg: #e8e7fb;
    --grey-bg: #eceef1;
    --sans: "Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    --mono: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    --radius: 6px;
    --fs: clamp(0.85rem, 0.8rem + 0.2vw, 0.95rem);
    --fs-title: clamp(1.15rem, 1rem + 0.8vw, 1.6rem);
    --fs-h2: clamp(0.95rem, 0.9rem + 0.3vw, 1.1rem);
    --fs-stat: clamp(1.3rem, 1rem + 1.2vw, 1.9rem);
    --pad: clamp(1rem, 2.5vw, 2rem);
    --t: 160ms;
  }
  @media (prefers-reduced-motion: reduce) { :root { --t: 0ms; } }
  html.reduce-motion { --t: 0ms; }

  * { box-sizing: border-box; }
  html, body { margin: 0; }
  body { background: var(--bg); color: var(--ink); font-family: var(--sans); font-size: var(--fs); line-height: 1.45; }

  .topbar { position: sticky; top: 0; z-index: 10; background: var(--surface); border-bottom: 1px solid var(--line); }
  .topbar-inner { max-width: 1480px; margin: 0 auto; padding: 0.7rem var(--pad); display: flex; align-items: center; gap: 1rem; flex-wrap: wrap; }
  .brand { font-weight: 700; font-size: var(--fs-title); letter-spacing: -0.01em; line-height: 1.15; }
  .brand small { display: block; font-weight: 400; color: var(--muted); font-size: 0.72rem; font-family: var(--mono); margin-top: 0.2rem; }
  .spacer { flex: 1; }
  .toggle { display: inline-flex; align-items: center; gap: 0.4rem; font-size: 0.8rem; color: var(--ink-2); cursor: pointer; user-select: none; }
  .toggle input { width: auto; margin: 0; }

  main { max-width: 1480px; margin: 0 auto; padding: var(--pad); display: grid; gap: var(--pad); }
  .loading { color: var(--muted); font-family: var(--mono); }

  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 1px; background: var(--line); border: 1px solid var(--line); border-radius: var(--radius); overflow: hidden; }
  .stat { background: var(--surface); padding: 0.85rem 1rem; }
  .stat .k { font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); font-family: var(--mono); }
  .stat .v { font-family: var(--mono); font-size: var(--fs-stat); font-weight: 600; margin-top: 0.1rem; font-variant-numeric: tabular-nums; line-height: 1.1; }
  .stat .v.warn { color: var(--amber); }
  .stat .v.bad { color: var(--red); }
  .stat .v.good { color: var(--green); }
  .stat .d { font-size: 0.75rem; color: var(--muted); margin-top: 0.2rem; }

  .card { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); overflow: hidden; }
  .card-head { display: flex; align-items: baseline; gap: 0.75rem; padding: 0.85rem 1rem; border-bottom: 1px solid var(--line); flex-wrap: wrap; }
  .card-head h2 { margin: 0; font-size: var(--fs-h2); font-weight: 650; }
  .card-head .count { font-family: var(--mono); color: var(--muted); font-size: 0.78rem; }
  .card-head p { margin: 0; color: var(--muted); font-size: 0.82rem; flex-basis: 100%; }
  .table-wrap { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 0.6rem 0.8rem; border-bottom: 1px solid var(--line); border-right: 1px solid var(--line); text-align: left; vertical-align: top; }
  th:last-child, td:last-child { border-right: 0; }
  th { background: var(--surface-2); font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); font-weight: 600; font-family: var(--mono); white-space: nowrap; }
  tbody tr:last-child td { border-bottom: 0; }
  tbody tr { transition: background var(--t); }
  tbody tr:hover { background: var(--surface-2); }
  td.num { font-family: var(--mono); font-variant-numeric: tabular-nums; white-space: nowrap; }
  .mono { font-family: var(--mono); font-variant-numeric: tabular-nums; }
  .deal { font-weight: 600; }
  .sub { color: var(--muted); font-size: 0.78rem; margin-top: 0.15rem; }
  .sub.mono { font-size: 0.74rem; }
  .empty { padding: 1.25rem 1rem; color: var(--muted); }

  .badge { display: inline-flex; align-items: center; gap: 0.35rem; padding: 0.15rem 0.5rem 0.15rem 0.4rem; border-radius: 999px; font-size: 0.66rem; font-weight: 600; font-family: var(--mono); letter-spacing: 0.05em; text-transform: uppercase; white-space: nowrap; }
  .badge::before { content: ""; width: 0.42rem; height: 0.42rem; border-radius: 50%; background: currentColor; flex: none; }
  .badge.monthly { background: var(--blue-bg); color: var(--blue); }
  .badge.term { background: var(--indigo-bg); color: var(--indigo); }
  .badge.unsupported { background: var(--amber-bg); color: var(--amber); }
  .badge.other { background: var(--grey-bg); color: var(--ink-2); }
  .badge.paid { background: var(--green-bg); color: var(--green); }
  .badge.payment_pending { background: var(--amber-bg); color: var(--amber); }
  .badge.unpaid, .badge.failed { background: var(--red-bg); color: var(--red); }

  input, select { width: 100%; padding: 0.42rem 0.55rem; border: 1px solid var(--line-strong); border-radius: var(--radius); font: inherit; font-size: 0.85rem; background: var(--surface); color: var(--ink); transition: border-color var(--t), box-shadow var(--t); }
  input:focus, select:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px rgba(36, 87, 230, 0.15); }
  input.mono { font-family: var(--mono); }
  input::placeholder { color: #9aa1ab; }

  .btn { display: inline-flex; align-items: center; gap: 0.4rem; padding: 0.42rem 0.8rem; border: 1px solid transparent; border-radius: var(--radius); font: inherit; font-size: 0.8rem; font-weight: 600; cursor: pointer; white-space: nowrap; background: var(--surface); color: var(--ink); transition: background var(--t), border-color var(--t), transform var(--t), opacity var(--t); }
  .btn:active:not(:disabled) { transform: translateY(1px); }
  .btn:disabled { opacity: 0.55; cursor: default; }
  .btn.primary { background: var(--accent); color: #fff; }
  .btn.primary:hover:not(:disabled) { background: var(--accent-hover); }
  .btn.secondary { border-color: var(--line-strong); }
  .btn.secondary:hover:not(:disabled) { background: var(--surface-2); }
  .btn.success { background: var(--green); color: #fff; }
  .btn.success:hover:not(:disabled) { background: #136b34; }
  .btn.teal { background: #0f766e; color: #fff; }
  .btn.teal:hover:not(:disabled) { background: #0c5f59; }
  .btn.violet { background: #6d28d9; color: #fff; }
  .btn.violet:hover:not(:disabled) { background: #5b21b6; }
  .btn.small { padding: 0.3rem 0.6rem; font-size: 0.75rem; }
  .spin { width: 0.75rem; height: 0.75rem; border: 2px solid rgba(255, 255, 255, 0.35); border-top-color: currentColor; border-radius: 50%; animation: spin 0.7s linear infinite; }
  .btn.secondary .spin { border-color: rgba(0, 0, 0, 0.15); border-top-color: currentColor; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .spin { animation: none; border-top-color: transparent; } }
  html.reduce-motion .spin { animation: none; border-top-color: transparent; }

  .row-actions { display: flex; gap: 0.4rem; flex-wrap: wrap; align-items: center; }
  .field-row { display: flex; gap: 0.4rem; align-items: center; }
  .field-row input { flex: 1; min-width: 90px; }
  .quote-form { display: grid; grid-template-columns: 96px minmax(140px, 1fr) minmax(140px, 1fr) auto; gap: 0.4rem; align-items: center; min-width: 440px; }
  .payment-form { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 0.45rem; margin-top: 0.55rem; padding: 0.65rem; border: 1px dashed var(--line-strong); border-radius: var(--radius); background: var(--surface-2); }
  .payment-form .full { grid-column: 1 / -1; }
  .payment-form .buttons { display: flex; gap: 0.4rem; grid-column: 1 / -1; }
  .warn { color: var(--amber); font-size: 0.78rem; }
  .status { font-size: 0.78rem; color: var(--muted); }
  .status.ok { color: var(--green); }
  .status.err { color: var(--red); }
  .reminders { font-family: var(--mono); letter-spacing: 0.18em; font-size: 0.95rem; }
  .reminders .on { color: var(--green); }
  .reminders .off { color: var(--line-strong); }
  .quote-now { margin-top: 0.45rem; }

  .toasts { position: fixed; right: 1rem; bottom: 1rem; display: grid; gap: 0.5rem; z-index: 50; max-width: min(480px, calc(100vw - 2rem)); }
  .toast { background: var(--ink); color: #fff; padding: 0.7rem 0.9rem; border-radius: var(--radius); font-size: 0.82rem; display: flex; gap: 0.6rem; align-items: flex-start; box-shadow: 0 6px 20px rgba(0, 0, 0, 0.18); animation: rise var(--t) ease-out; }
  .toast.ok { background: var(--green); }
  .toast.err { background: var(--red); }
  .toast .x { margin-left: auto; background: transparent; border: 0; color: inherit; cursor: pointer; font-size: 1rem; line-height: 1; padding: 0 0 0 0.4rem; }
  @keyframes rise { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }

  footer { max-width: 1480px; margin: 0 auto; padding: 0 var(--pad) var(--pad); color: var(--muted); font-size: 0.72rem; font-family: var(--mono); display: flex; gap: 1rem; flex-wrap: wrap; }
</style>
</head>
<body>
<header class="topbar">
  <div class="topbar-inner">
    <div class="brand">Renewal Billing<small id="brand-sub">VA pipeline · loading…</small></div>
    <div class="spacer"></div>
    <label class="toggle"><input type="checkbox" id="motion-toggle"> Reduce motion</label>
    <button class="btn secondary small" id="refresh-btn" type="button">Refresh</button>
  </div>
</header>

<main>
  <p class="loading" id="loading">Loading deals from HubSpot and Supabase…</p>

  <section class="stats" id="stats" style="display:none"></section>

  <section class="card" id="deals-card" style="display:none">
    <div class="card-head">
      <h2>Clients</h2>
      <span class="count" id="deals-count"></span>
      <p>How each client is billed: the cycle length from the latest HubSpot line item's term, the quote date from the deal's <strong>Next Renewal Date</strong>. Quotes go out automatically at 11:00 IST on that date, and the date moves forward by one cycle when the client pays. Quotes and invoices are emailed <strong>only</strong> to the <strong>Accountant email</strong> (HubSpot's Accountant Email field; saving writes it back to HubSpot). With no accountant email, nothing is emailed and the client gets WhatsApp only.</p>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th style="min-width:200px">Deal</th>
            <th style="width:130px">Stage</th>
            <th style="min-width:250px">Billing</th>
            <th style="width:260px">Accountant email</th>
            <th style="width:230px">Base price / month</th>
            <th style="min-width:460px">One-time quote</th>
          </tr>
        </thead>
        <tbody id="deals-body"></tbody>
      </table>
    </div>
  </section>

  <section class="card" id="cycles-card" style="display:none">
    <div class="card-head">
      <h2>Billing cycles</h2>
      <span class="count" id="cycles-count"></span>
      <p id="cycles-subtitle"></p>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th style="min-width:180px">Deal</th>
            <th style="width:150px">Cycle</th>
            <th style="width:140px">Status</th>
            <th style="min-width:170px">Quote</th>
            <th style="min-width:170px">Payment</th>
            <th style="width:110px">Reminders</th>
            <th style="min-width:320px">Actions</th>
          </tr>
        </thead>
        <tbody id="cycles-body"></tbody>
      </table>
    </div>
  </section>

  <section class="card" id="additions-card" style="display:none">
    <div class="card-head">
      <h2>One-time quotes</h2>
      <span class="count" id="additions-count"></span>
      <p>Sent to the client's WhatsApp group and by email. PAID once the Razorpay payment arrives and the invoice is generated.</p>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th style="min-width:180px">Deal</th>
            <th style="min-width:200px">Service</th>
            <th style="width:120px">Amount</th>
            <th style="min-width:170px">Quote</th>
            <th style="width:140px">Status</th>
            <th style="min-width:220px">Delivery</th>
          </tr>
        </thead>
        <tbody id="additions-body"></tbody>
      </table>
    </div>
  </section>
</main>

<footer>
  <span>Hand-coded internal tool · no tracking · data read live from HubSpot, Zoho, Razorpay and Supabase</span>
  <span id="loaded-at"></span>
</footer>

<div class="toasts" id="toasts" aria-live="polite"></div>

<script>
const STAGE_NAMES = { '3668025064': 'Ready for Renewal', '3102360263': 'Renewal Done', '2462646003': 'Payment Done' };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

function money(value) {
  return value === null || value === undefined ? '—' : 'INR ' + Number(value).toLocaleString('en-IN');
}

function fmtDate(iso) {
  if (!iso) return '—';
  const m = /^(\\d{4})-(\\d{2})-(\\d{2})/.exec(iso);
  if (!m) return iso;
  return Number(m[3]) + ' ' + MONTHS[Number(m[2]) - 1] + ' ' + m[1];
}

function stageName(id) {
  return STAGE_NAMES[id] || id;
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// Motion is optional: honour the OS setting and a manual toggle (kept per browser).
(function initMotion() {
  const toggle = document.getElementById('motion-toggle');
  let saved = false;
  try { saved = localStorage.getItem('reduceMotion') === '1'; } catch (err) { saved = false; }
  toggle.checked = saved;
  document.documentElement.classList.toggle('reduce-motion', saved);
  toggle.onchange = () => {
    document.documentElement.classList.toggle('reduce-motion', toggle.checked);
    try { localStorage.setItem('reduceMotion', toggle.checked ? '1' : '0'); } catch (err) { /* private mode */ }
  };
})();

// Feedback: a toast for every async result. Successes fade; errors and
// outstanding steps stay until dismissed.
function toast(kind, text, sticky) {
  const box = el('div', 'toast ' + kind);
  box.appendChild(el('span', null, text));
  const close = el('button', 'x', '×');
  close.type = 'button';
  close.setAttribute('aria-label', 'Dismiss');
  close.onclick = () => box.remove();
  box.appendChild(close);
  document.getElementById('toasts').appendChild(box);
  if (!sticky) setTimeout(() => box.remove(), 7000);
}

// A button shows what it is doing while a request runs; the deliberate
// pause makes the action legible instead of instant and ambiguous.
function busy(btn, label) {
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = '';
  btn.appendChild(el('span', 'spin'));
  btn.appendChild(el('span', null, label));
  return () => { btn.disabled = false; btn.textContent = original; };
}

function deliverySummary(result) {
  return 'WhatsApp ' + (result.periskopeSent ? 'sent' : 'skipped: ' + result.periskopeSkipReason) +
    ' · email ' + (result.emailSent ? 'sent' : 'not sent: ' + result.emailError);
}

function settlementSummary(result) {
  const parts = [];
  parts.push(result.recordedPayment ? 'Marked PAID' : 'Already paid via ' + result.paidVia);
  if (result.invoiceNumber) parts.push('invoice ' + result.invoiceNumber);
  parts.push(result.whatsappSent ? 'WhatsApp sent' : 'WhatsApp not sent');
  parts.push(result.emailSent ? 'email sent' : 'email not sent');
  parts.push(result.hubspotDone ? 'HubSpot updated' : 'HubSpot pending');
  if (result.errors && result.errors.length) parts.push('OUTSTANDING: ' + result.errors.join('; '));
  return parts.join(' · ');
}

function renderStats(data) {
  const deals = data.deals;
  let monthly = 0, term = 0, attention = 0, quotingToday = 0, datePassed = 0, noEmail = 0;
  for (const d of deals) {
    const b = d.billing;
    if (b.kind === 'cycle') {
      if (b.months === 1) monthly++; else term++;
      if (b.due && !b.quoted) { if (b.daysOverdue < 4) quotingToday++; else datePassed++; }
      if (!b.periodStart) datePassed++;
    } else {
      attention++;
    }
    if (!d.email.accountantValid) noEmail++;
  }
  const cycles = deals.flatMap((d) => d.cycles);
  const unpaid = cycles.filter((c) => c.status !== 'paid').length;

  const stats = [
    ['Active clients', deals.length, '', 'in the VA pipeline'],
    ['Monthly', monthly, '', 'quoted on their Next Renewal Date'],
    ['Quarterly / half-yearly', term, '', 'quoted on their Next Renewal Date'],
    ['Quoting today', quotingToday, quotingToday ? 'good' : '', 'the 11:00 IST run sends these'],
    ['Renewal date needs fixing', datePassed, datePassed ? 'warn' : 'good', 'missing or passed without a quote'],
    ['Needs HubSpot fix', attention, attention ? 'bad' : 'good', 'unsupported term or no line item'],
    ['No accountant email', noEmail, noEmail ? 'warn' : 'good', 'these clients get WhatsApp only'],
    ['Unpaid cycles', unpaid, unpaid ? 'warn' : 'good', 'awaiting payment'],
    ['One-time quotes', data.additions.length, '', 'sent so far'],
  ];
  const wrap = document.getElementById('stats');
  wrap.innerHTML = '';
  for (const [k, v, tone, d] of stats) {
    const s = el('div', 'stat');
    s.appendChild(el('div', 'k', k));
    s.appendChild(el('div', 'v' + (tone ? ' ' + tone : ''), String(v)));
    s.appendChild(el('div', 'd', d));
    wrap.appendChild(s);
  }
}

function billingCell(deal) {
  const td = document.createElement('td');
  const b = deal.billing;
  const badgeClass = b.kind === 'cycle' ? (b.months === 1 ? 'monthly' : 'term') : b.kind === 'unsupported' ? 'unsupported' : 'other';
  td.appendChild(el('span', 'badge ' + badgeClass, b.label));
  if (b.kind !== 'cycle') {
    td.appendChild(el('div', 'sub', b.reason));
    return td;
  }
  if (b.months !== 1) td.appendChild(el('div', 'sub', 'Last paid ' + money(b.amount) + ', quoted the same'));
  if (!b.periodStart) {
    td.appendChild(el('div', 'sub warn', b.reason + ' — set the Next Renewal Date in HubSpot'));
  } else if (!b.due) {
    td.appendChild(el('div', 'sub', 'Next quote on ' + fmtDate(b.periodStart) + ', automatic at 11:00 IST'));
  } else if (b.quoted) {
    td.appendChild(el('div', 'sub', 'Quoted for the period from ' + fmtDate(b.periodStart)));
  } else if (b.daysOverdue < 4) {
    td.appendChild(el('div', 'sub', 'Due: the 11:00 IST run quotes it today'));
  } else {
    td.appendChild(el('div', 'sub warn', 'Next Renewal Date ' + fmtDate(b.periodStart) + ' passed ' + b.daysOverdue + ' days ago without a quote — update it in HubSpot'));
  }
  return td;
}

function emailCell(deal) {
  const td = document.createElement('td');
  const e = deal.email;
  const row = el('div', 'field-row');
  const input = document.createElement('input');
  input.type = 'email';
  input.className = 'mono';
  input.value = e.accountantEmail ?? '';
  input.placeholder = 'not set — no email is sent';
  const saveBtn = el('button', 'btn secondary small', 'Save');
  saveBtn.type = 'button';
  saveBtn.onclick = async () => {
    const email = input.value.trim();
    const done = busy(saveBtn, 'Saving');
    try {
      await postJson('/admin/pricing/accountant-email', { dealId: deal.dealId, email });
      toast('ok', deal.dealName + ': accountant email ' + (email ? 'saved to HubSpot' : 'cleared — no email will be sent'));
      await loadDeals();
    } catch (err) {
      toast('err', deal.dealName + ': ' + err.message, true);
      done();
    }
  };
  row.appendChild(input);
  row.appendChild(saveBtn);
  td.appendChild(row);
  if (e.accountantValid) {
    td.appendChild(el('div', 'sub', 'Quotes and invoices are emailed here'));
  } else {
    td.appendChild(el('div', 'sub warn', (e.accountantEmail ? 'Not a valid email — ignored. ' : '') + 'No email is sent for this client — WhatsApp only'));
  }
  return td;
}

function renderDeals(data) {
  const tbody = document.getElementById('deals-body');
  tbody.innerHTML = '';
  document.getElementById('deals-count').textContent = data.deals.length + ' deals';

  for (const deal of data.deals) {
    const tr = document.createElement('tr');
    tr.dataset.dealId = deal.dealId;

    const nameTd = el('td', null);
    nameTd.appendChild(el('div', 'deal', deal.dealName));
    nameTd.appendChild(el('div', 'sub mono', deal.dealId));
    tr.appendChild(nameTd);

    tr.appendChild(el('td', null, stageName(deal.dealStage)));
    tr.appendChild(billingCell(deal));
    tr.appendChild(emailCell(deal));

    const priceTd = document.createElement('td');
    const priceRow = el('div', 'field-row');
    const priceInput = document.createElement('input');
    priceInput.type = 'number';
    priceInput.min = '0';
    priceInput.className = 'mono';
    priceInput.value = deal.basePrice ?? '';
    priceInput.placeholder = 'not set';
    const saveBtn = el('button', 'btn secondary small', 'Save');
    saveBtn.type = 'button';
    saveBtn.onclick = async () => {
      const basePrice = Number(priceInput.value);
      if (!Number.isFinite(basePrice) || basePrice < 0) { toast('err', 'Enter a valid price for ' + deal.dealName, true); return; }
      const done = busy(saveBtn, 'Saving');
      try {
        await postJson('/admin/pricing/base-price', { dealId: deal.dealId, basePrice, dealName: deal.dealName });
        toast('ok', deal.dealName + ': base price saved as ' + money(basePrice));
      } catch (err) {
        toast('err', deal.dealName + ': ' + err.message, true);
      } finally {
        done();
      }
    };
    priceRow.appendChild(priceInput);
    priceRow.appendChild(saveBtn);
    priceTd.appendChild(priceRow);
    if (deal.billing.kind === 'monthly') priceTd.appendChild(el('div', 'sub', 'Used for the monthly quote'));
    if (deal.billing.kind === 'term') priceTd.appendChild(el('div', 'sub', 'Not used — term quotes bill the last-paid amount'));
    tr.appendChild(priceTd);

    const additionTd = document.createElement('td');
    const form = el('div', 'quote-form');
    const amountInput = document.createElement('input');
    amountInput.type = 'number';
    amountInput.min = '0';
    amountInput.className = 'mono';
    amountInput.placeholder = 'Amount';
    const serviceInput = document.createElement('input');
    serviceInput.type = 'text';
    serviceInput.placeholder = 'Service (e.g. site visit)';
    const narrationInput = document.createElement('input');
    narrationInput.type = 'text';
    narrationInput.placeholder = 'Narration (optional)';
    const sendBtn = el('button', 'btn success small', 'Send quote');
    sendBtn.type = 'button';
    sendBtn.onclick = async () => {
      const amount = Number(amountInput.value);
      const service = serviceInput.value.trim();
      const narration = narrationInput.value.trim();
      if (!Number.isFinite(amount) || amount <= 0) { toast('err', 'Enter a valid amount for ' + deal.dealName, true); return; }
      if (!service) { toast('err', 'Enter the service for ' + deal.dealName, true); return; }
      if (!confirm('Send a one-time quote of ' + money(amount) + ' for "' + service + '" to ' + deal.dealName + '? It goes to the client\\'s WhatsApp group and email.')) return;
      const done = busy(sendBtn, 'Sending…');
      try {
        const result = await postJson('/admin/pricing/send-addition', { dealId: deal.dealId, amount, service, narration });
        const outstanding = !result.periskopeSent || !result.emailSent;
        toast(outstanding ? 'err' : 'ok', deal.dealName + ': quote ' + result.zohoEstimateNumber + ' · ' + deliverySummary(result), outstanding);
        amountInput.value = '';
        serviceInput.value = '';
        narrationInput.value = '';
        await loadDeals();
      } catch (err) {
        toast('err', deal.dealName + ': ' + err.message, true);
        done();
      }
    };
    form.appendChild(amountInput);
    form.appendChild(serviceInput);
    form.appendChild(narrationInput);
    form.appendChild(sendBtn);
    additionTd.appendChild(form);
    tr.appendChild(additionTd);

    tbody.appendChild(tr);
  }
}

function paymentForm(deal, cycle, today) {
  const form = el('div', 'payment-form');
  const amount = document.createElement('input');
  amount.type = 'number';
  amount.min = '0';
  amount.step = '0.01';
  amount.className = 'mono';
  amount.value = cycle.quoteTotal ?? '';
  amount.placeholder = 'Amount';
  const date = document.createElement('input');
  date.type = 'date';
  date.className = 'mono';
  date.value = today;
  date.max = today;
  const method = document.createElement('select');
  for (const [value, label] of [['upi', 'UPI'], ['neft', 'NEFT / IMPS / RTGS'], ['cheque', 'Cheque'], ['cash', 'Cash'], ['yes_bank', 'Yes Bank'], ['other', 'Other']]) {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = label;
    method.appendChild(opt);
  }
  const narration = document.createElement('input');
  narration.type = 'text';
  narration.placeholder = 'Narration / description';
  const reference = document.createElement('input');
  reference.type = 'text';
  reference.className = 'mono';
  reference.placeholder = 'Reference (UTR etc.)';
  const save = el('button', 'btn violet small', 'Save payment');
  save.type = 'button';
  const cancel = el('button', 'btn secondary small', 'Cancel');
  cancel.type = 'button';
  const warn = el('div', 'warn full');

  const checkAmount = () => {
    const entered = Number(amount.value);
    warn.textContent = cycle.quoteTotal !== null && Number.isFinite(entered) && entered !== Number(cycle.quoteTotal)
      ? 'Amount differs from the quote total (' + money(cycle.quoteTotal) + '). The cycle will still be marked PAID.'
      : '';
  };
  amount.oninput = checkAmount;

  save.onclick = async () => {
    const entered = Number(amount.value);
    if (!Number.isFinite(entered) || entered <= 0) { toast('err', 'Enter a valid amount', true); return; }
    if (!date.value) { toast('err', 'Enter the payment date', true); return; }
    const done = busy(save, 'Saving…');
    try {
      const result = await postJson('/admin/pricing/record-payment', {
        jobId: cycle.jobId,
        method: method.value,
        amount: entered,
        paymentDate: date.value,
        narration: narration.value.trim(),
        reference: reference.value.trim(),
      });
      const outstanding = result.errors && result.errors.length > 0;
      toast(outstanding ? 'err' : 'ok', deal.dealName + ' (' + cycle.billingPeriod + '): ' + settlementSummary(result), outstanding);
      await loadDeals();
    } catch (err) {
      toast('err', deal.dealName + ': ' + err.message, true);
      done();
    }
  };
  cancel.onclick = () => form.remove();

  const buttons = el('div', 'buttons');
  buttons.appendChild(save);
  buttons.appendChild(cancel);

  form.appendChild(amount);
  form.appendChild(date);
  form.appendChild(method);
  form.appendChild(narration);
  form.appendChild(reference);
  form.appendChild(warn);
  form.appendChild(buttons);
  return form;
}

// "Paid through Yes Bank" asks for the real payment date: the accountant
// often sees the transfer a day or two later, and HubSpot's Date Paid must
// carry the day the money actually arrived.
function yesBankForm(deal, cycle, today) {
  const form = el('div', 'payment-form');
  const label = el('div', 'full', 'Yes Bank payment of ' + money(cycle.quoteTotal) + ' for ' + deal.dealName + ' (' + cycle.billingPeriod + ')');
  label.style.fontWeight = '600';
  const date = document.createElement('input');
  date.type = 'date';
  date.className = 'mono';
  date.value = today;
  date.max = today;
  const narration = document.createElement('input');
  narration.type = 'text';
  narration.placeholder = 'Narration (optional, e.g. bank reference)';
  const save = el('button', 'btn teal small', 'Confirm payment');
  save.type = 'button';
  const cancel = el('button', 'btn secondary small', 'Cancel');
  cancel.type = 'button';
  const hint = el('div', 'sub full', 'Payment date = the day the money reached the bank. It is written to HubSpot as Date Paid.');

  save.onclick = async () => {
    if (!date.value) { toast('err', 'Enter the payment date', true); return; }
    const done = busy(save, 'Recording…');
    try {
      const result = await postJson('/admin/pricing/record-payment', {
        jobId: cycle.jobId,
        method: 'yes_bank',
        paymentDate: date.value,
        narration: narration.value.trim(),
      });
      const outstanding = result.errors && result.errors.length > 0;
      toast(outstanding ? 'err' : 'ok', deal.dealName + ' (' + cycle.billingPeriod + '): ' + settlementSummary(result), outstanding);
      await loadDeals();
    } catch (err) {
      toast('err', deal.dealName + ': ' + err.message, true);
      done();
    }
  };
  cancel.onclick = () => form.remove();

  const buttons = el('div', 'buttons');
  buttons.appendChild(save);
  buttons.appendChild(cancel);

  form.appendChild(label);
  form.appendChild(date);
  form.appendChild(narration);
  form.appendChild(hint);
  form.appendChild(buttons);
  return form;
}

function remindersCell(count) {
  const td = el('td', null);
  const dots = el('span', 'reminders');
  for (let i = 1; i <= 3; i++) {
    dots.appendChild(el('span', i <= count ? 'on' : 'off', i <= count ? '●' : '○'));
  }
  td.appendChild(dots);
  td.appendChild(el('div', 'sub mono', count + ' of 3 sent'));
  return td;
}

function renderCycles(data) {
  const tbody = document.getElementById('cycles-body');
  tbody.innerHTML = '';
  document.getElementById('cycles-subtitle').textContent =
    'Month ' + data.cycle.monthKey + '. Each cycle is keyed by the day it starts, the Next Renewal Date in HubSpot. Unpaid cycles stay listed until paid.';

  let rows = 0;
  for (const deal of data.deals) {
    for (const cycle of deal.cycles) {
      rows++;
      const tr = document.createElement('tr');

      const nameTd = el('td', null);
      nameTd.appendChild(el('div', 'deal', deal.dealName));
      tr.appendChild(nameTd);

      const cycleTd = el('td', 'num', cycle.billingPeriod);
      if (cycle.servicePeriod) cycleTd.appendChild(el('div', 'sub', cycle.servicePeriod.replace('Service period: ', '')));
      tr.appendChild(cycleTd);

      const statusTd = document.createElement('td');
      statusTd.appendChild(el('span', 'badge ' + cycle.status, cycle.status.replace('_', ' ')));
      if (cycle.issue) statusTd.appendChild(el('div', 'sub', cycle.issue));
      tr.appendChild(statusTd);

      const quoteTd = el('td', 'num', cycle.quoteNumber || '—');
      quoteTd.appendChild(el('div', 'sub mono', money(cycle.quoteTotal)));
      if (cycle.invoiceNumber) quoteTd.appendChild(el('div', 'sub mono', 'Invoice ' + cycle.invoiceNumber));
      tr.appendChild(quoteTd);

      const paymentTd = document.createElement('td');
      if (cycle.status === 'paid') {
        paymentTd.appendChild(el('div', 'mono', money(cycle.paymentAmount) + ' · ' + fmtDate(cycle.paymentDate)));
        paymentTd.appendChild(el('div', 'sub', (cycle.paymentMethod || '').replace('_', ' ')));
        if (cycle.paymentNarration) paymentTd.appendChild(el('div', 'sub', cycle.paymentNarration));
      } else {
        paymentTd.textContent = '—';
      }
      tr.appendChild(paymentTd);

      tr.appendChild(remindersCell(cycle.remindersSent));

      const actionsTd = document.createElement('td');
      if (cycle.status !== 'paid' && cycle.quoteNumber) {
        const actions = el('div', 'row-actions');
        const bankBtn = el('button', 'btn teal small', 'Paid through Yes Bank');
        bankBtn.type = 'button';
        const manualBtn = el('button', 'btn violet small', 'Record manual payment');
        manualBtn.type = 'button';
        bankBtn.onclick = () => {
          const existing = actionsTd.querySelector('.payment-form');
          if (existing) { existing.remove(); return; }
          actionsTd.appendChild(yesBankForm(deal, cycle, data.cycle.today));
        };
        manualBtn.onclick = () => {
          const existing = actionsTd.querySelector('.payment-form');
          if (existing) { existing.remove(); return; }
          actionsTd.appendChild(paymentForm(deal, cycle, data.cycle.today));
        };
        actions.appendChild(bankBtn);
        actions.appendChild(manualBtn);
        actionsTd.appendChild(actions);
      } else if (cycle.status === 'paid') {
        actionsTd.appendChild(el('div', 'sub', 'Settled'));
      } else {
        actionsTd.appendChild(el('div', 'sub', 'Waiting for the quote'));
      }
      tr.appendChild(actionsTd);

      tbody.appendChild(tr);
    }
  }
  document.getElementById('cycles-count').textContent = rows + (rows === 1 ? ' cycle' : ' cycles');

  if (rows === 0) {
    const tr = document.createElement('tr');
    const td = el('td', 'empty', 'No billing cycles yet. A quote goes out automatically at 11:00 IST on each client Next Renewal Date; a row appears here the moment it is sent, with Paid through Yes Bank and Record manual payment beside it.');
    td.colSpan = 7;
    tr.appendChild(td);
    tbody.appendChild(tr);
  }
}

function renderAdditions(data) {
  const tbody = document.getElementById('additions-body');
  tbody.innerHTML = '';
  document.getElementById('additions-count').textContent = data.additions.length + (data.additions.length === 1 ? ' quote' : ' quotes');

  for (const quote of data.additions) {
    const tr = document.createElement('tr');

    const nameTd = el('td', null);
    nameTd.appendChild(el('div', 'deal', quote.dealName));
    nameTd.appendChild(el('div', 'sub mono', fmtDate(quote.createdAt)));
    tr.appendChild(nameTd);

    const serviceTd = el('td', null, quote.service);
    if (quote.narration) serviceTd.appendChild(el('div', 'sub', quote.narration));
    tr.appendChild(serviceTd);

    tr.appendChild(el('td', 'num', money(quote.amount)));

    const quoteTd = el('td', 'num', quote.quoteNumber || '—');
    quoteTd.appendChild(el('div', 'sub mono', money(quote.quoteTotal)));
    if (quote.invoiceNumber) quoteTd.appendChild(el('div', 'sub mono', 'Invoice ' + quote.invoiceNumber));
    tr.appendChild(quoteTd);

    const statusTd = document.createElement('td');
    statusTd.appendChild(el('span', 'badge ' + quote.status, quote.status.replace('_', ' ')));
    if (quote.issue) statusTd.appendChild(el('div', 'sub', quote.issue));
    tr.appendChild(statusTd);

    const deliveryTd = el('td', null,
      'WhatsApp ' + (quote.whatsappSent ? 'sent' : 'not sent') +
      ' · quote email ' + (quote.emailSent ? 'sent' : 'not sent') +
      (quote.status === 'paid' ? ' · invoice email ' + (quote.invoiceEmailSent ? 'sent' : 'not sent') : ''));
    if (quote.whatsappSkipReason && !quote.whatsappSent) deliveryTd.appendChild(el('div', 'sub', quote.whatsappSkipReason));
    if (quote.emailError) deliveryTd.appendChild(el('div', 'sub', quote.emailError));
    tr.appendChild(deliveryTd);

    tbody.appendChild(tr);
  }

  if (data.additions.length === 0) {
    const tr = document.createElement('tr');
    const td = el('td', 'empty', 'No one-time quotes yet. Use the one-time quote column in the Clients table to send one.');
    td.colSpan = 6;
    tr.appendChild(td);
    tbody.appendChild(tr);
  }
}

async function loadDeals() {
  const res = await fetch('/admin/pricing/deals');
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to load');

  renderStats(data);
  renderDeals(data);
  renderCycles(data);
  renderAdditions(data);

  document.getElementById('brand-sub').textContent = 'VA pipeline · today ' + fmtDate(data.cycle.today) + ' IST · month ' + data.cycle.monthKey;
  document.getElementById('loaded-at').textContent = 'refreshed ' + new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  document.getElementById('loading').style.display = 'none';
  for (const id of ['stats', 'deals-card', 'cycles-card', 'additions-card']) {
    document.getElementById(id).style.display = '';
  }
}

document.getElementById('refresh-btn').onclick = async () => {
  const btn = document.getElementById('refresh-btn');
  const done = busy(btn, 'Refreshing');
  try {
    await loadDeals();
  } catch (err) {
    toast('err', 'Refresh failed: ' + err.message, true);
  } finally {
    done();
  }
};

loadDeals().catch((err) => {
  document.getElementById('loading').textContent = 'Failed to load: ' + err.message;
});
</script>
</body>
</html>
`;
