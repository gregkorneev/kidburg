import { mountRadioPreview } from './preview.js';
import { createRadioNetworkClient } from './network.js';

export function startRadioStation({
  root = globalThis.document?.querySelector('#radio-app'),
  window: win = globalThis.window,
  networkFactory = createRadioNetworkClient,
  networkOptions = {},
  previewFactory = mountRadioPreview,
} = {}) {
  if (!root) throw new TypeError('Radio station root is required');
  const client = networkFactory(networkOptions);
  let unmountPreview;
  try {
    unmountPreview = previewFactory({ api: client.api, root, window: win });
    client.start();
  } catch (error) {
    client.stop();
    throw error;
  }

  let disposed = false;
  function dispose() {
    if (disposed) return;
    disposed = true;
    win.removeEventListener('pagehide', onPageHide);
    try {
      unmountPreview();
    } finally {
      client.stop();
    }
  }
  function onPageHide(event) {
    if (!event.persisted) dispose();
  }

  win.addEventListener('pagehide', onPageHide);
  return dispose;
}

if (globalThis.document?.querySelector('#radio-app')) void startRadioStation();
