/**
 * The signed-in staff member for every screen inside the desk. Set once by the desk layout after
 * the session check, so a screen never renders without knowing the role.
 */
import type { StaffSessionResponse } from "@cashback/contracts";
import { createContext, useContext } from "react";

export const StaffContext = createContext<StaffSessionResponse | null>(null);

export function useStaff(): StaffSessionResponse {
  const staff = useContext(StaffContext);
  if (staff === null) throw new Error("useStaff outside the signed-in desk");
  return staff;
}
