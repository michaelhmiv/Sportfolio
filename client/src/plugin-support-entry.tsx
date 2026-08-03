import { createRoot } from "react-dom/client";
import PluginSupportPage from "./pages/plugin-support";
import "./index.css";

const stored = localStorage.getItem("sf-theme");
const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
document.documentElement.classList.toggle("dark", stored ? stored === "dark" : prefersDark);
createRoot(document.getElementById("root")!).render(<PluginSupportPage />);
