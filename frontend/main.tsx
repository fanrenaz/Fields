import "./styles/globals.css";

import { createRoot } from "react-dom/client";

import App from "./App";

const root = document.getElementById("root");
if (!root) throw new Error("Fields requires a #root mount element.");

createRoot(root).render(<App />);
