/**
 * The command words the assistant answers. Kept on their own so the
 * dispatcher (commands.ts) and the bank parser (bank-details.ts) can both
 * read them without importing each other.
 */
export const ORDERS_COMMANDS = new Set(["donhang", "orders"]);
export const ID_COMMANDS = new Set(["id", "ma", "code"]);
export const PASSWORD_COMMANDS = new Set(["matkhau", "pass", "password"]);
export const BANK_COMMANDS = new Set(["bank", "stk", "taikhoan"]);
