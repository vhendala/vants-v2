// @vants/web: the mini app (SPEC §3.2, §5.3, T-021, T-023), on the Vants design system.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./design/tokens.css";
import "./design/ds.css";
import "./styles.css";

try {
  localStorage.removeItem("vants.theme"); // the app is light-only (T-024); forget an earlier theme choice
} catch {
  // storage blocked: nothing to forget
}

const root = document.getElementById("root");
if (!root) throw new Error("#root missing from index.html");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
