/**
 * The identity module (AD-1): customers, aliases, codes, sessions, staff and bank accounts
 * (AD-23). It depends on no other module. Other modules reach it only through this file (code.md
 * §1).
 */
export { bankFingerprint, lastFour, normaliseAccountNumber } from "./bank-fingerprint";
export { CustomerCodeError, issueCustomerCode } from "./customer-code.command";
export { resolveCustomer, type ResolvedCustomer } from "./customer.query";
export { counterAbove, customerCodeNumber, CUSTOMER_CODE_PREFIX, formatCustomerCode } from "./domain/customer-code";
export {
  IdentityImportError,
  importIdentity,
  type IdentityImport,
  type IdentityImportResult,
  type ImportedAlias,
  type ImportedBankAccount,
  type ImportedCustomer,
  type ImportedCustomerStatus,
} from "./identity-import.command";
export { CUSTOMER_ROLES, type CustomerRole } from "./schema";
