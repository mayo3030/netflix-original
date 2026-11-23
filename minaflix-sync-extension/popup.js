const button = document.getElementById('export');
const catalog = document.getElementById('catalog');
const cap = document.getElementById('cap');
const trailers = document.getElementById('trailers');
const status = document.getElementById('status');
const summary = document.getElementById('summary');
const lines = [];

function pushStatus(text) {
  lines.push(text);
  status.textContent = lines.slice(-8).join('\n');
}

function showLines(next) {
  lines.length = 0;
  for (const line of next || []) lines.push(line);
  status.textContent = lines.slice(-8).join('\n');
}

function setBusy(busy) {
  button.disabled = busy;
  catalog.disabled = busy;
  if (cap) cap.disabled = busy;
  if (trailers) trailers.disabled = busy;
}

const port = chrome.runtime.connect({ name: 'minaflix-export' });
port.onMessage.addListener((message) => {
  if (Array.isArray(message?.lines) && message.lines.length) showLines(message.lines);
  if (message?.type === 'progress' && typeof message.text === 'string') {
    if (!message.lines) pushStatus(message.text);
    if (/running in the background/.test(message.text)) setBusy(true);
  }
  if (message?.type === 'summary') summary.textContent = message.text || '';
  if (message?.type === 'done') {
    summary.textContent = message.text || summary.textContent || 'Export finished.';
    setBusy(false);
  }
  if (message?.type === 'error') {
    pushStatus(message.text || 'Export failed.');
    setBusy(false);
  }
});
port.onDisconnect.addListener(() => {
  if (button.disabled) pushStatus('Catalog sync keeps running after this popup closes. Reopen it to see progress.');
  setBusy(false);
});
port.postMessage({ type: 'watch' });

function startExport(mode) {
  setBusy(true);
  lines.length = 0;
  summary.textContent = '';
  pushStatus(mode === 'catalog' ? 'Starting catalog sync… It keeps running if this popup closes.' : 'Starting…');
  const detailCap = mode === 'catalog' && cap && cap.value.trim() !== '' ? Number(cap.value) : null;
  const lookupTrailers = mode === 'catalog' && Boolean(trailers?.checked);
  port.postMessage({ type: 'start', mode, detailCap, lookupTrailers });
}

button.addEventListener('click', () => startExport('lists'));
catalog.addEventListener('click', () => startExport('catalog'));
