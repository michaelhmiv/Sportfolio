import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { initSentry } from "./lib/sentry";

initSentry();

/**
 * P3 — 5.1: OS dark/light mode sync.
 * The app defaults to dark. Respect a user-stored preference, otherwise follow the OS.
 * The HTML element keeps class="dark" as a hard default (for SSR/pre-render safety).
 */
function applyTheme(prefersDark: boolean): void {
  const stored = localStorage.getItem("sf-theme");
  const isDark = stored ? stored === "dark" : prefersDark;
  document.documentElement.classList.toggle("dark", isDark);
}

if (typeof window !== "undefined") {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  applyTheme(mq.matches);
  mq.addEventListener("change", (e) => applyTheme(e.matches));
}

createRoot(document.getElementById("root")!).render(<App />);
