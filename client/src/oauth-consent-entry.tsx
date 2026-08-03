import { createRoot } from "react-dom/client";
import OAuthConsentPage from "./pages/oauth-consent";
import "./index.css";

function applyTheme(): void {
  const stored = localStorage.getItem("sf-theme");
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.classList.toggle("dark", stored ? stored === "dark" : prefersDark);
}

applyTheme();
createRoot(document.getElementById("root")!).render(<OAuthConsentPage />);
