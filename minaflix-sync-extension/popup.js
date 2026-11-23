const button = document.getElementById('export');
const status = document.getElementById('status');

button.addEventListener('click', () => {
  button.disabled = true;
  status.textContent = 'Starting…';
  const port = chrome.runtime.connect({ name: 'minaflix-export' });
  port.onMessage.addListener((message) => {
    if (message?.type === 'progress' && typeof message.text === 'string') {
      status.textContent = message.text;
    }
    if (message?.type === 'done') {
      status.textContent = message.text || 'Saved minaflix-netflix-export.json.';
      button.disabled = false;
      port.disconnect();
    }
    if (message?.type === 'error') {
      status.textContent = message.text || 'Export failed.';
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
