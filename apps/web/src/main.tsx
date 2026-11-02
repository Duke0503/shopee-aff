import "./index.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App, createQueryClient } from "./app";
import { webText } from "./labels";
import { createAppRouter } from "./router";

document.title = webText("brand_name");
const root = document.getElementById("root");
if (root !== null) {
  createRoot(root).render(
    <StrictMode>
      <App router={createAppRouter()} queryClient={createQueryClient()} />
    </StrictMode>,
  );
}
