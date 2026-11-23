const button = document.getElementById('export');
const status = document.getElementById('status');
const summary = document.getElementById('summary');
const lines = [];

function pushStatus(text) {
  lines.push(text);
  status.textContent = lines.slice(-8).join('\n');
}

function startExport(mode) {
  button.disabled = true;
  catalog.disabled = true;
  if (cap) cap.disabled = true;
  lines.length = 0;
  summary.textContent = '';
  pushStatus(mode === 'catalog' ? 'Starting catalog sync…' : 'Starting…');
  const port = chrome.runtime.connect({ name: 'minaflix-export' });
  port.onMessage.addListener((message) => {
    if (message?.type === 'progress' && typeof message.text === 'string') {
      pushStatus(message.text);
    }
    if (message?.type === 'summary') {
      summary.textContent = message.text || '';
    }
    if (message?.type === 'done') {
      summary.textContent = message.text || 'Exported 0 watched, 0 My List';
      button.disabled = false;
      catalog.disabled = false;
      if (cap) cap.disabled = false;
      port.disconnect();
    }
    if (message?.type === 'error') {
      pushStatus(message.text || 'Export failed.');
      button.disabled = false;
      catalog.disabled = false;
      if (cap) cap.disabled = false;
      port.disconnect();
    }
  });
  port.onDisconnect.addListener(() => {
    if (button.disabled) {
      status.textContent = 'Paused. Open the extension again to resume a catalog sync.';
      button.disabled = false;
      catalog.disabled = false;
      if (cap) cap.disabled = false;
    }
  });
  const detailCap = mode === 'catalog' && cap && cap.value.trim() !== '' ? Number(cap.value) : null;
  port.postMessage({ type: 'start', mode, detailCap });
}

const catalog = document.getElementById('catalog');
const cap = document.getElementById('cap');
button.addEventListener('click', () => startExport('lists'));
catalog.addEventListener('click', () => startExport('catalog'));
