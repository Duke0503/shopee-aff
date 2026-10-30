import { createRoot } from "react-dom/client";

import { ShellPage } from "./shell.page";

const container = document.getElementById("root");
if (container) {
  createRoot(container).render(<ShellPage />);
}
