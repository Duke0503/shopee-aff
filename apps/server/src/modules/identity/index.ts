/**
 * The identity module (AD-1): customers, aliases, codes, sessions, staff and bank accounts
 * (AD-23). It depends on no other module. Other modules reach it only through this file (code.md
 * §1).
 */
export { bankFingerprint, lastFour, normaliseAccountNumber } from "./bank-fingerprint";
export { accountNumberOf, bankAccountOfCustomer, bankAccountsOf, customerBankState, bankDisplayName, sharedBankFingerprints, type BankAccountFacts } from "./bank-account.query";
export { distinctiveBankText, findVietQrBank, plainBankText, VIETQR_BANKS, type VietQrBank } from "./domain/bank-match";
export { CustomerCodeError, issueCustomerCode } from "./customer-code.command";
export { CustomerRegisterError, DISPLAY_NAME_MAX, registerCustomer, REGISTRATION_CHANNELS, ZALO_USER_ID_PATTERN, type Registered, type RegistrationChannel, type RegistrationInput } from "./customer-register.command";
export { earnsNothing, erasedIdsOf, ledgerOwnerOf, type LedgerOwner, customerCardOf, newCustomerCount, customerCardsOf, customerCodeOf, customerProfileOf, deskCustomerOf, deskCustomers, DESK_CUSTOMER_ROLES, isDeskCustomer, guestCustomerIds, isGuestCustomer, customerKeys, resolveCustomer, type CustomerKeys, type CustomerProfile, type DeskCustomer, type ResolvedCustomer } from "./customer.query";
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
export { CUSTOMER_ROLES, SESSION_END_REASONS, SESSION_KINDS, type CustomerRole, type SessionEndReason, type SessionKind } from "./schema";
export { signInDelayMs } from "./domain/sign-in-delay";
export { DEFAULT_ARGON2, hashPassword, MAX_PASSWORD_LENGTH, verifyPassword, type Argon2Params } from "./password-hash";
export { newSessionToken, SESSION_TOKEN_BYTES, sessionTokenHash, type SessionToken } from "./session-token";
export { endSession, openSession, STAFF_SESSION_MS, type OpenedSession, type SessionOwner } from "./session.command";
export { staffNamesOf, staffSessionOf, staffSessionsFor } from "./staff-session.query";
export { customerSessionOf } from "./customer-session.query";
export { DUMMY_HASH, signInStaff, type StaffSignIn, type StaffSignInDeps, type StaffSignInInput } from "./staff-sign-in.command";
export { staffSessionRoutes, type StaffSessionRouteDeps } from "./http/staff-session.routes";
export {
  MIN_STAFF_PASSWORD,
  planStaffSeed,
  resetStaffPassword,
  seedStaff,
  setStaffAccess,
  STAFF_SEED_ACTOR,
  StaffAdminError,
  type SeedMember,
  type SeedPlan,
  type StaffAccess,
  type StaffAdminErrorCode,
  type StaffSeed,
} from "./staff-admin.command";
export { checkErase, CustomerEraseError, ERASE_REASON_MAX, eraseCustomer, type EraseErrorCode, type EraseInput, type ErasedCustomer, type OwedMoney } from "./customer-erase.command";
export { applyMerge, CustomerMergeError, planMerge, type MergeErrorCode, type MergePlan, type MergeSide } from "./customer-merge.command";
export { LIVE_ZALO_UID, zaloRecipientOf, type ZaloRecipient } from "./zalo-recipient.query";
