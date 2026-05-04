
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

createRoot(document.getElementById("root")!).render(<App />);

// ─── Service worker registration ────────────────────────────────────────
// Production-only by default. Vite serves `/public/*` at the root, so the
// scope `/` covers the whole app. Failure is silent — PWA is enhancement,
// never a hard requirement.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((err) => {
            // eslint-disable-next-line no-console
            console.warn('[sw] registration failed:', err);
        });
    });
}
