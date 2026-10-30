import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { useStore } from "./store";
import "./styles.css";

/** Re-renders everything when the language changes. */
function Root() {
  const lang = useStore((s) => s.lang);
  document.documentElement.lang = lang;
  return <App key={lang} />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
