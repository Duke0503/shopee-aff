import { createRoot } from "react-dom/client";

import { ConsolePage } from "./console.page";

const container = document.getElementById("root");
if (container) {
  createRoot(container).render(<ConsolePage />);
}
