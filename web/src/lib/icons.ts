/**
 * Every icon in the app, named for what it MEANS.
 *
 * Two rules, and both exist because of what happens when they are
 * broken.
 *
 * ONE SET. Not react-icons: that is a bundle of twenty different icon
 * families, and importing FaLock beside MdPayment beside BsWallet puts
 * three different pen strokes on one screen. That mix is exactly what
 * makes an app look like nobody decided anything. Lucide is one family,
 * one 1.5px stroke, drawn by one hand -- so anything picked from it
 * matches anything else picked from it, for free.
 *
 * NAMED BY MEANING, NOT BY PICTURE. A component asks for `Icon.owed`,
 * never `Wallet`. It has no business knowing whether money owed is
 * drawn as a wallet or a banknote this month. With the names in here,
 * changing the whole visual language is an edit to this file; with
 * `import { Wallet }` scattered across eight components, it is eight
 * edits and one that gets missed.
 */

import type { LucideIcon } from "lucide-react"
import {
  AlertTriangle,
  ArrowUpDown,
  Banknote,
  BookOpen,
  Check,
  ChevronDown,
  Clock,
  Copy,
  CreditCard,
  ExternalLink,
  Eye,
  EyeOff,
  House,
  Inbox,
  KeyRound,
  Landmark,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  Package,
  Pencil,
  RefreshCw,
  Send,
  ShieldCheck,
  User,
  Wallet,
  X,
  XCircle,
} from "lucide-react"

export const Icon = {
  // Money, in the three states it can be in
  owed: Wallet,
  payable: Banknote,
  pending: Clock,
  paid: Landmark,
  rejected: XCircle,

  // Things
  home: House,
  order: Package,
  bank: Landmark,
  card: CreditCard,
  reference: Copy,
  user: User,
  guide: BookOpen,

  // Doing something
  confirm: Check,
  send: Send,
  refresh: RefreshCw,
  expand: ChevronDown,
  sort: ArrowUpDown,
  open: ExternalLink,
  copy: Copy,
  edit: Pencil,
  close: X,
  signOut: LogOut,

  // Signing in
  signIn: LockKeyhole,
  password: KeyRound,
  reveal: Eye,
  conceal: EyeOff,
  shield: ShieldCheck,

  // States
  warning: AlertTriangle,
  busy: LoaderCircle,
  empty: Inbox,
} as const

export type IconName = keyof typeof Icon
export type { LucideIcon }
