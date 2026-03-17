import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from '@/app/App';

// Register service worker — auto-update on new deployment
registerSW({
  immediate: true,
  onRegisterError(err) {
    console.error('[SW] Registration failed:', err);
  },
});

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element #root not found in index.html');

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
