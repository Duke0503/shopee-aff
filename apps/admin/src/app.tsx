/** The desk's providers, shared by the browser entry and the tests. */
import { TooltipProvider } from "@cashback/ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";

import type { AppRouter } from "./router";

export function createQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true } } });
}

export function App({ router, queryClient }: { readonly router: AppRouter; readonly queryClient: QueryClient }) {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={300}>
        <RouterProvider router={router} />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
