import type { ReactElement } from "react";

import { colors, spacing } from "@mmo/ui";

import { useCustomers } from "./features/customers/customers.queries";

/** Admin customer list: id, DP code, name, role, whether bank details exist. */
export function CustomersPage(): ReactElement {
  const { customers, error } = useCustomers();

  if (error !== "") return <p style={{ color: colors.brand }}>{error}</p>;

  return (
    <main style={{ padding: spacing.lg, color: colors.text }}>
      <h1>Customers</h1>
      <table>
        <thead>
          <tr>
            <th>Code</th>
            <th>Name</th>
            <th>Role</th>
            <th>Bank</th>
          </tr>
        </thead>
        <tbody>
          {customers.map((customer) => (
            <tr key={customer.customerId}>
              <td>{customer.customerCode ?? "-"}</td>
              <td>{customer.displayName ?? "-"}</td>
              <td>{customer.role}</td>
              <td>{customer.hasBankDetails ? "yes" : "no"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
