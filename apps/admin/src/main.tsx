import { createRoot } from "react-dom/client";

import { PayoutsPage } from "./payouts.page";

const container = document.getElementById("root");
if (container) {
  createRoot(container).render(<PayoutsPage />);
}
