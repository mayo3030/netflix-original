const button = document.getElementById('export');
const status = document.getElementById('status');
const lines = [];

function pushStatus(text) {
  lines.push(text);
  status.textContent = lines.slice(-8).join('\n');
}

button.addEventListener('click', () => {
  button.disabled = true;
  lines.length = 0;
  pushStatus('Starting…');
  const port = chrome.runtime.connect({ name: 'minaflix-export' });
  port.onMessage.addListener((message) => {
    if (message?.type === 'progress' && typeof message.text === 'string') {
      pushStatus(message.text);
    }
    if (message?.type === 'done') {
      pushStatus(message.text || 'Saved minaflix-netflix-export.json.');
      button.disabled = false;
      port.disconnect();
    }
    if (message?.type === 'error') {
      pushStatus(message.text || 'Export failed.');
      button.disabled = false;
      port.disconnect();
    }
  });
  port.onDisconnect.addListener(() => {
    if (button.disabled) {
      status.textContent = 'The export stopped. Open Netflix, sign in, and try again.';
      button.disabled = false;
    }
  });
  port.postMessage({ type: 'start' });
});
