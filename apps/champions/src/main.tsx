import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";
import { loadGeneratedSpeciesData } from "./lib/species";
import { loadMovesData } from "./lib/movesCache";

async function boot() {
  // Overlay 繁中 names / classic base stats + CBD Doubles move usage from public/data.
  await Promise.all([loadGeneratedSpeciesData(), loadMovesData()]);
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

void boot();
