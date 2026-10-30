import "./index.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App, createQueryClient } from "./app";
import { createAppRouter, DOCUMENT_TITLE } from "./router";

document.title = DOCUMENT_TITLE;
const root = document.getElementById("root");
if (root !== null) {
  createRoot(root).render(
    <StrictMode>
      <App router={createAppRouter()} queryClient={createQueryClient()} />
    </StrictMode>,
  );
}
