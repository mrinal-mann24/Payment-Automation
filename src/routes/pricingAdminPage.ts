export const pricingAdminHtml = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Renewal Pricing</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 2rem; background: #f7f7f8; color: #111; }
  h1 { font-size: 1.4rem; }
  h2 { font-size: 1.1rem; margin-top: 2.5rem; }
  .subtitle { color: #555; font-size: 0.9rem; margin: -0.5rem 0 1rem; }
  table { width: 100%; border-collapse: collapse; background: white; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
  th, td { padding: 0.6rem 0.8rem; border-bottom: 1px solid #e5e5e5; text-align: left; font-size: 0.9rem; vertical-align: top; }
  th { background: #fafafa; font-weight: 600; }
  input[type=number], input[type=text], input[type=date], select { width: 100%; padding: 0.3rem; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box; }
  button { padding: 0.4rem 0.8rem; border: none; border-radius: 4px; cursor: pointer; font-size: 0.85rem; }
  .save-btn { background: #2563eb; color: white; }
  .send-btn { background: #16a34a; color: white; }
  .bank-btn { background: #0f766e; color: white; }
  .manual-btn { background: #7c3aed; color: white; }
  .cancel-btn { background: #e5e7eb; color: #111; }
  button:disabled { opacity: 0.5; cursor: default; }
  .addition-cell { display: flex; gap: 0.4rem; align-items: center; }
  .addition-cell input[type=number] { width: 90px; }
  .status { font-size: 0.8rem; margin-left: 0.5rem; }
  .status.ok { color: #16a34a; }
  .status.err { color: #dc2626; }
  .muted { color: #666; font-size: 0.8rem; }
  .badge { display: inline-block; padding: 0.15rem 0.5rem; border-radius: 999px; font-size: 0.75rem; font-weight: 600; }
  .badge.paid { background: #dcfce7; color: #166534; }
  .badge.payment_pending { background: #fef3c7; color: #92400e; }
  .badge.unpaid { background: #fee2e2; color: #991b1b; }
  .badge.monthly { background: #dbeafe; color: #1e40af; }
  .badge.other { background: #e5e7eb; color: #374151; }
  .actions { display: flex; gap: 0.4rem; flex-wrap: wrap; }
  .payment-form { display: grid; grid-template-columns: 110px 140px 120px 1fr 140px auto auto; gap: 0.4rem; align-items: center; margin-top: 0.5rem; }
  .warn { color: #b45309; font-size: 0.8rem; grid-column: 1 / -1; }
</style>
</head>
<body>
<h1>Renewal Pricing — VA Pipeline</h1>
<p id="loading">Loading deals…</p>
<table id="deals-table" style="display:none">
  <thead>
    <tr>
      <th>Deal</th>
      <th>Stage</th>
      <th style="width:220px">Billing</th>
      <th style="width:140px">Base price</th>
      <th style="width:120px"></th>
      <th style="width:340px">Addition (amount + description)</th>
    </tr>
  </thead>
  <tbody id="deals-body"></tbody>
</table>

<h2 id="cycles-heading" style="display:none">Billing cycles</h2>
<p id="cycles-subtitle" class="subtitle" style="display:none"></p>
<table id="cycles-table" style="display:none">
  <thead>
    <tr>
      <th>Deal</th>
      <th style="width:90px">Cycle</th>
      <th style="width:120px">Status</th>
      <th>Quote</th>
      <th>Payment</th>
      <th style="width:90px">Reminders</th>
      <th style="width:300px">Actions</th>
    </tr>
  </thead>
  <tbody id="cycles-body"></tbody>
</table>

<script>
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

function money(value) {
  return value === null || value === undefined ? '—' : 'INR ' + Number(value).toLocaleString('en-IN');
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

function renderDeals(data) {
  const tbody = document.getElementById('deals-body');
  tbody.innerHTML = '';

  for (const deal of data.deals) {
    const tr = document.createElement('tr');
    tr.dataset.dealId = deal.dealId;

    tr.appendChild(el('td', null, deal.dealName));
    tr.appendChild(el('td', null, deal.dealStage));

    const billingTd = document.createElement('td');
    if (deal.billing.monthly) {
      billingTd.appendChild(el('span', 'badge monthly', 'Monthly'));
      if (deal.billing.due === false) billingTd.appendChild(el('div', 'muted', deal.billing.reason));
    } else {
      billingTd.appendChild(el('span', 'badge other', 'Not monthly'));
      billingTd.appendChild(el('div', 'muted', deal.billing.reason));
    }
    tr.appendChild(billingTd);

    const priceTd = document.createElement('td');
    const priceInput = document.createElement('input');
    priceInput.type = 'number';
    priceInput.min = '0';
    priceInput.value = deal.basePrice ?? '';
    priceInput.placeholder = 'not set';
    priceTd.appendChild(priceInput);
    tr.appendChild(priceTd);

    const saveTd = document.createElement('td');
    const saveBtn = el('button', 'save-btn', 'Save');
    const saveStatus = el('span', 'status');
    saveBtn.onclick = async () => {
      saveBtn.disabled = true;
      saveStatus.textContent = '';
      try {
        const basePrice = Number(priceInput.value);
        if (!Number.isFinite(basePrice) || basePrice < 0) throw new Error('Enter a valid price');
        await postJson('/admin/pricing/base-price', { dealId: deal.dealId, basePrice, dealName: deal.dealName });
        saveStatus.textContent = 'Saved';
        saveStatus.className = 'status ok';
      } catch (err) {
        saveStatus.textContent = err.message;
        saveStatus.className = 'status err';
      } finally {
        saveBtn.disabled = false;
      }
    };
    saveTd.appendChild(saveBtn);
    saveTd.appendChild(saveStatus);
    tr.appendChild(saveTd);

    const additionTd = document.createElement('td');
    const additionCell = el('div', 'addition-cell');
    const amountInput = document.createElement('input');
    amountInput.type = 'number';
    amountInput.min = '0';
    amountInput.placeholder = 'Amount';
    const descInput = document.createElement('input');
    descInput.type = 'text';
    descInput.placeholder = 'Description (e.g. monthly site visit)';
    const sendBtn = el('button', 'send-btn', 'Send');
    const sendStatus = el('span', 'status');
    sendBtn.onclick = async () => {
      sendBtn.disabled = true;
      sendStatus.textContent = '';
      try {
        const amount = Number(amountInput.value);
        const description = descInput.value.trim();
        if (!Number.isFinite(amount) || amount <= 0) throw new Error('Enter a valid amount');
        if (!description) throw new Error('Enter a description');
        const body = await postJson('/admin/pricing/send-addition', { dealId: deal.dealId, amount, description });
        sendStatus.textContent = body.periskopeSent ? 'Sent' : 'Quote created, WhatsApp skipped: ' + body.periskopeSkipReason;
        sendStatus.className = 'status ok';
        amountInput.value = '';
        descInput.value = '';
      } catch (err) {
        sendStatus.textContent = err.message;
        sendStatus.className = 'status err';
      } finally {
        sendBtn.disabled = false;
      }
    };
    additionCell.appendChild(amountInput);
    additionCell.appendChild(descInput);
    additionCell.appendChild(sendBtn);
    additionTd.appendChild(additionCell);
    additionTd.appendChild(sendStatus);
    tr.appendChild(additionTd);

    tbody.appendChild(tr);
  }
}

function paymentForm(cycle, today, onDone) {
  const form = el('div', 'payment-form');
  const amount = document.createElement('input');
  amount.type = 'number';
  amount.min = '0';
  amount.step = '0.01';
  amount.value = cycle.quoteTotal ?? '';
  amount.placeholder = 'Amount';
  const date = document.createElement('input');
  date.type = 'date';
  date.value = today;
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
  reference.placeholder = 'Reference (UTR etc.)';
  const save = el('button', 'manual-btn', 'Save payment');
  const cancel = el('button', 'cancel-btn', 'Cancel');
  const warn = el('div', 'warn');
  const status = el('span', 'status');

  const checkAmount = () => {
    const entered = Number(amount.value);
    warn.textContent = cycle.quoteTotal !== null && Number.isFinite(entered) && entered !== Number(cycle.quoteTotal)
      ? 'Note: amount differs from the quote total (' + money(cycle.quoteTotal) + '). The cycle will still be marked PAID.'
      : '';
  };
  amount.oninput = checkAmount;

  save.onclick = async () => {
    save.disabled = true;
    status.textContent = '';
    try {
      const entered = Number(amount.value);
      if (!Number.isFinite(entered) || entered <= 0) throw new Error('Enter a valid amount');
      if (!date.value) throw new Error('Enter the payment date');
      const result = await postJson('/admin/pricing/record-payment', {
        jobId: cycle.jobId,
        method: method.value,
        amount: entered,
        paymentDate: date.value,
        narration: narration.value.trim(),
        reference: reference.value.trim(),
      });
      status.textContent = settlementSummary(result);
      status.className = 'status ok';
      onDone();
    } catch (err) {
      status.textContent = err.message;
      status.className = 'status err';
      save.disabled = false;
    }
  };
  cancel.onclick = () => form.remove();

  form.appendChild(amount);
  form.appendChild(date);
  form.appendChild(method);
  form.appendChild(narration);
  form.appendChild(reference);
  form.appendChild(save);
  form.appendChild(cancel);
  form.appendChild(warn);
  form.appendChild(status);
  return form;
}

function renderCycles(data) {
  const tbody = document.getElementById('cycles-body');
  tbody.innerHTML = '';
  document.getElementById('cycles-subtitle').textContent =
    'Current cycle ' + data.cycle.key + ' — ' + data.cycle.narration + '. Unpaid cycles from earlier months stay listed until paid.';

  let rows = 0;
  for (const deal of data.deals) {
    for (const cycle of deal.cycles) {
      rows++;
      const tr = document.createElement('tr');
      tr.appendChild(el('td', null, deal.dealName));

      const cycleTd = el('td', null, cycle.billingPeriod);
      if (cycle.servicePeriod) cycleTd.appendChild(el('div', 'muted', cycle.servicePeriod));
      tr.appendChild(cycleTd);

      const statusTd = document.createElement('td');
      statusTd.appendChild(el('span', 'badge ' + cycle.status, cycle.status.replace('_', ' ').toUpperCase()));
      if (cycle.issue) statusTd.appendChild(el('div', 'muted', cycle.issue));
      tr.appendChild(statusTd);

      const quoteTd = el('td', null, (cycle.quoteNumber || '—') + ' · ' + money(cycle.quoteTotal));
      if (cycle.invoiceNumber) quoteTd.appendChild(el('div', 'muted', 'Invoice ' + cycle.invoiceNumber));
      tr.appendChild(quoteTd);

      const paymentTd = document.createElement('td');
      if (cycle.status === 'paid') {
        paymentTd.textContent = (cycle.paymentMethod || '').replace('_', ' ') + ' · ' + money(cycle.paymentAmount) + ' · ' + (cycle.paymentDate || '');
        if (cycle.paymentNarration) paymentTd.appendChild(el('div', 'muted', cycle.paymentNarration));
      } else {
        paymentTd.textContent = '—';
      }
      tr.appendChild(paymentTd);

      tr.appendChild(el('td', null, String(cycle.remindersSent) + ' / 3'));

      const actionsTd = document.createElement('td');
      if (cycle.status !== 'paid' && cycle.quoteNumber) {
        const actions = el('div', 'actions');
        const bankBtn = el('button', 'bank-btn', 'Paid through Yes Bank');
        const manualBtn = el('button', 'manual-btn', 'Add One-Time Payment');
        const status = el('span', 'status');
        bankBtn.onclick = async () => {
          if (!confirm('Mark ' + deal.dealName + ' (' + cycle.billingPeriod + ') as PAID through Yes Bank for ' + money(cycle.quoteTotal) + '?')) return;
          const narration = prompt('Narration (optional, e.g. bank reference):', '') ?? '';
          bankBtn.disabled = true;
          manualBtn.disabled = true;
          try {
            const result = await postJson('/admin/pricing/record-payment', { jobId: cycle.jobId, method: 'yes_bank', narration: narration.trim() });
            status.textContent = settlementSummary(result);
            status.className = 'status ok';
            await loadDeals();
          } catch (err) {
            status.textContent = err.message;
            status.className = 'status err';
            bankBtn.disabled = false;
            manualBtn.disabled = false;
          }
        };
        manualBtn.onclick = () => {
          const existing = actionsTd.querySelector('.payment-form');
          if (existing) { existing.remove(); return; }
          actionsTd.appendChild(paymentForm(cycle, data.cycle.today, () => loadDeals()));
        };
        actions.appendChild(bankBtn);
        actions.appendChild(manualBtn);
        actionsTd.appendChild(actions);
        actionsTd.appendChild(status);
      }
      tr.appendChild(actionsTd);

      tbody.appendChild(tr);
    }
  }

  if (rows === 0) {
    const tr = document.createElement('tr');
    const td = el('td', 'muted', 'No billing cycles yet. Monthly quotes are generated on the 1st of each month.');
    td.colSpan = 7;
    tr.appendChild(td);
    tbody.appendChild(tr);
  }
}

async function loadDeals() {
  const res = await fetch('/admin/pricing/deals');
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to load');

  renderDeals(data);
  renderCycles(data);

  document.getElementById('loading').style.display = 'none';
  document.getElementById('deals-table').style.display = '';
  document.getElementById('cycles-heading').style.display = '';
  document.getElementById('cycles-subtitle').style.display = '';
  document.getElementById('cycles-table').style.display = '';
}

loadDeals().catch((err) => {
  document.getElementById('loading').textContent = 'Failed to load: ' + err.message;
});
</script>
</body>
</html>
`;
