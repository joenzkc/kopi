import React from 'react';
import ReactDOM from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from './App';
import { ValueVisibilityProvider } from './lib/valueVisibility';
import './index.css';

// Keep installed copies current: check for a new deploy on launch, whenever the app comes back to the
// foreground, and hourly. With registerType 'autoUpdate' the page reloads itself once the new version is ready,
// so a deploy shows up the next time Kopi is opened instead of only after it has been closed and reopened twice.
registerSW({
  immediate: true,
  onRegisteredSW(_swUrl, registration) {
    if (!registration) return;
    const check = () => {
      if (navigator.onLine) void registration.update().catch(() => undefined);
    };
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') check();
    });
    window.setInterval(check, 60 * 60 * 1000);
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ValueVisibilityProvider>
      <App />
    </ValueVisibilityProvider>
  </React.StrictMode>,
);
