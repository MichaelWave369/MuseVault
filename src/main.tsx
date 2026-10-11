import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode><App /></React.StrictMode>
);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(import.meta.env.BASE_URL + 'sw.js', { scope: import.meta.env.BASE_URL })
      .then(async () => {
        const registration = await navigator.serviceWorker.ready;
        // Precache the Vite-generated script and stylesheet during the first online visit.
        const urls = Array.from(document.querySelectorAll('script[src], link[rel="stylesheet"][href]'))
          .map(el => el instanceof HTMLScriptElement ? el.src : (el as HTMLLinkElement).href)
          .filter(url => url.startsWith(location.origin + import.meta.env.BASE_URL));
        registration.active?.postMessage({ type: 'PRECACHE', urls });
      })
      .catch(() => { /* Online use remains available if offline caching is blocked. */ });
  });
}
