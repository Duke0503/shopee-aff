/**
 * The command words the assistant answers. Kept on their own so the
 * dispatcher (commands.ts) and the bank parser (bank-details.ts) can both
 * read them without importing each other.
 */
export const ORDERS_COMMANDS = new Set(["donhang", "orders", "don", "lichsu"]);
export const ID_COMMANDS = new Set(["id", "ma", "code"]);
export const PASSWORD_COMMANDS = new Set(["matkhau", "pass", "password"]);
export const BANK_COMMANDS = new Set(["bank", "stk", "taikhoan", "tk"]);
export const BALANCE_COMMANDS = new Set(["sodu", "tien", "kiemtra"]);
export const PING_COMMANDS = new Set(["ping"]);
export const HELP_COMMANDS = new Set(["help", "huongdan", "trogiup"]);
export const POLICY_COMMANDS = new Set(["chinhsach", "coche"]);
export const TERMS_COMMANDS = new Set(["dieukien"]);
export const BANK_GUIDE_COMMANDS = new Set(["nganhang"]);
export const WEBSITE_COMMANDS = new Set(["web"]);
export const ERASE_BANK_COMMANDS = new Set(["xoathongtin", "xoabank"]);
export const TOPDEAL_COMMANDS = new Set(["topdeal", "hot"]);
