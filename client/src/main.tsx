import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { initSentry } from "./lib/sentry";

initSentry();

// Register Service Worker for PWA
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .then((registration) => {
        if (import.meta.env.DEV) {
          console.log("SW registered:", registration.scope);
        }
      })
      .catch((error) => {
        if (import.meta.env.DEV) {
          console.log("SW registration failed:", error);
        }
      });
  });
}

createRoot(document.getElementById("root")!).render(<App />);
