export const pricingAdminHtml = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Renewal Pricing</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 2rem; background: #f7f7f8; color: #111; }
  h1 { font-size: 1.4rem; }
  table { width: 100%; border-collapse: collapse; background: white; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
  th, td { padding: 0.6rem 0.8rem; border-bottom: 1px solid #e5e5e5; text-align: left; font-size: 0.9rem; }
  th { background: #fafafa; font-weight: 600; }
  input[type=number], input[type=text] { width: 100%; padding: 0.3rem; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box; }
  button { padding: 0.4rem 0.8rem; border: none; border-radius: 4px; cursor: pointer; font-size: 0.85rem; }
  .save-btn { background: #2563eb; color: white; }
  .send-btn { background: #16a34a; color: white; }
  button:disabled { opacity: 0.5; cursor: default; }
  .addition-cell { display: flex; gap: 0.4rem; align-items: center; }
  .addition-cell input[type=number] { width: 90px; }
  .status { font-size: 0.8rem; margin-left: 0.5rem; }
  .status.ok { color: #16a34a; }
  .status.err { color: #dc2626; }
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
      <th style="width:140px">Base price</th>
      <th style="width:120px"></th>
      <th style="width:340px">Addition (amount + description)</th>
    </tr>
  </thead>
  <tbody id="deals-body"></tbody>
</table>

<script>
async function loadDeals() {
  const res = await fetch('/admin/pricing/deals');
  const data = await res.json();
  const tbody = document.getElementById('deals-body');
  tbody.innerHTML = '';

  for (const deal of data.deals) {
    const tr = document.createElement('tr');
    tr.dataset.dealId = deal.dealId;

    const nameTd = document.createElement('td');
    nameTd.textContent = deal.dealName;
    tr.appendChild(nameTd);

    const stageTd = document.createElement('td');
    stageTd.textContent = deal.dealStage;
    tr.appendChild(stageTd);

    const priceTd = document.createElement('td');
    const priceInput = document.createElement('input');
    priceInput.type = 'number';
    priceInput.min = '0';
    priceInput.value = deal.basePrice ?? '';
    priceInput.placeholder = 'not set';
    priceTd.appendChild(priceInput);
    tr.appendChild(priceTd);

    const saveTd = document.createElement('td');
    const saveBtn = document.createElement('button');
    saveBtn.className = 'save-btn';
    saveBtn.textContent = 'Save';
    const saveStatus = document.createElement('span');
    saveStatus.className = 'status';
    saveBtn.onclick = async () => {
      saveBtn.disabled = true;
      saveStatus.textContent = '';
      try {
        const basePrice = Number(priceInput.value);
        if (!Number.isFinite(basePrice) || basePrice < 0) throw new Error('Enter a valid price');
        const res = await fetch('/admin/pricing/base-price', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dealId: deal.dealId, basePrice, dealName: deal.dealName }),
        });
        if (!res.ok) throw new Error((await res.json()).error || 'Save failed');
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
    const additionCell = document.createElement('div');
    additionCell.className = 'addition-cell';

    const amountInput = document.createElement('input');
    amountInput.type = 'number';
    amountInput.min = '0';
    amountInput.placeholder = 'Amount';

    const descInput = document.createElement('input');
    descInput.type = 'text';
    descInput.placeholder = 'Description (e.g. monthly site visit)';

    const sendBtn = document.createElement('button');
    sendBtn.className = 'send-btn';
    sendBtn.textContent = 'Send';

    const sendStatus = document.createElement('span');
    sendStatus.className = 'status';

    sendBtn.onclick = async () => {
      sendBtn.disabled = true;
      sendStatus.textContent = '';
      try {
        const amount = Number(amountInput.value);
        const description = descInput.value.trim();
        if (!Number.isFinite(amount) || amount <= 0) throw new Error('Enter a valid amount');
        if (!description) throw new Error('Enter a description');
        const res = await fetch('/admin/pricing/send-addition', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dealId: deal.dealId, amount, description }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || 'Send failed');
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

  document.getElementById('loading').style.display = 'none';
  document.getElementById('deals-table').style.display = '';
}

loadDeals().catch((err) => {
  document.getElementById('loading').textContent = 'Failed to load: ' + err.message;
});
</script>
</body>
</html>
`;
