"""Letting a customer see their own ledger, without a new identity.

WHY NOT A PHONE NUMBER
----------------------
The Zalo Bot API hands over an id and a display name and nothing else. A
phone number belongs to Zalo OA, needs the customer to tap through a
consent screen, and would be one more piece of personal data to hold.
There is no reason to collect one: the bot already has the only fact
that matters, which is that this person controls that Zalo account.

So the bot is the channel. A customer types a command, the bot replies
privately with a password, and they sign in with it. That is an ordinary
password reset, with Zalo where the email would be.

WHY A REQUEST IS A RESET, NOT A REMINDER
----------------------------------------
Competing tools re-send the current password on request, which means
they can read it, which means it is stored recoverably. This guards
bank account numbers; that is not a trade worth making.

`issue_password` therefore mints a NEW password every time and stores
only a hash. The old one stops working the moment a new one is issued,
and the message says so. Nobody -- including whoever runs this -- can
read a customer's password out of the database.

A derived password would be worse still: if it can be computed from the
customer id, then anyone who knows the id and the method has the
account. These come from `secrets`.

SESSIONS
--------
A signed-in browser holds a random token. The database holds its hash,
so a stolen database does not hand over live sessions either.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

# Long enough to resist guessing, short enough to read off a phone and
# type with a thumb. No look-alike characters: a customer reading 0 as O
# is a support message, not a security event.
ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
PASSWORD_LENGTH = 8

# PBKDF2 rather than a bare hash: a leaked table should not turn into a
# list of passwords overnight. Stdlib only -- adding argon2 would mean a
# compiled dependency on a machine that has to keep running unattended.
PBKDF2_ROUNDS = 240_000

SESSION_DAYS = 30
SESSION_BYTES = 32

# Five wrong guesses inside the window and the account stops answering.
# Without this, an eight-character password over a local network is a
# afternoon's work for a script.
MAX_ATTEMPTS = 5
LOCKOUT_MINUTES = 15


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _stamp(moment: datetime) -> str:
    return moment.isoformat(timespec="seconds")


# ----------------------------------------------------------------------
# Passwords
# ----------------------------------------------------------------------

def new_password() -> str:
    """A fresh password. Never derived from anything about the customer."""
    return "".join(secrets.choice(ALPHABET) for _ in range(PASSWORD_LENGTH))


def hash_password(password: str, salt: str | None = None) -> str:
    """`pbkdf2$rounds$salt$hash`, self-describing so rounds can change."""
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), salt.encode("utf-8"), PBKDF2_ROUNDS)
    return f"pbkdf2${PBKDF2_ROUNDS}${salt}${digest.hex()}"


def verify_password(password: str, stored: str | None) -> bool:
    if not stored:
        return False
    try:
        scheme, rounds, salt, digest = stored.split("$")
    except ValueError:
        return False
    if scheme != "pbkdf2":
        return False
    candidate = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), salt.encode("utf-8"), int(rounds))
    # Constant time: a comparison that returns early leaks the prefix.
    return hmac.compare_digest(candidate.hex(), digest)


def issue_password(conn: sqlite3.Connection, customer_id: str) -> str | None:
    """Mint a new password for this customer and return it, once.

    Returns None if there is no such customer. The plaintext is returned
    here and nowhere else -- it is not written to the database, not
    logged, and cannot be read back afterwards.

    Any existing password stops working immediately. Asking again is a
    reset, and the message that carries it has to say so, or a customer
    who asks out of curiosity is locked out of a session they had open.
    """
    row = conn.execute(
        "SELECT 1 FROM customers WHERE customer_id=?", (customer_id,)).fetchone()
    if row is None:
        return None

    password = new_password()
    conn.execute(
        "UPDATE customers SET password_hash=?, password_set_at=?,"
        "       failed_logins=0, locked_until=NULL"
        " WHERE customer_id=?",
        (hash_password(password), _stamp(_now()), customer_id),
    )
    # Every session signed in with the old password ends here. A password
    # reset that leaves old sessions alive is not a reset.
    conn.execute("DELETE FROM sessions WHERE customer_id=?", (customer_id,))
    return password


def change_password(conn: sqlite3.Connection, customer_id: str,
                    current: str, replacement: str) -> tuple[bool, str]:
    """Let a signed-in customer choose their own. (ok, reason)."""
    row = conn.execute(
        "SELECT password_hash FROM customers WHERE customer_id=?",
        (customer_id,)).fetchone()
    if row is None:
        return False, "unknown_customer"
    if not verify_password(current, row["password_hash"]):
        return False, "wrong_password"
    if len(replacement or "") < PASSWORD_LENGTH:
        return False, "too_short"
    conn.execute(
        "UPDATE customers SET password_hash=?, password_set_at=?"
        " WHERE customer_id=?",
        (hash_password(replacement), _stamp(_now()), customer_id),
    )
    return True, "ok"


# ----------------------------------------------------------------------
# Signing in
# ----------------------------------------------------------------------

@dataclass
class LoginResult:
    ok: bool
    reason: str
    token: str = ""
    customer_id: str = ""


def _hash_token(token: str) -> str:
    """Sessions are stored hashed for the same reason passwords are."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def resolve_login_name(conn: sqlite3.Connection, name: str) -> str | None:
    """Accept either the customer code or the Zalo id behind it.

    A customer reads "C0003" off the bot, but the one they remember is
    often the long Zalo number, and being told "no such account" for an
    id they can see on screen is how they conclude it is broken.
    """
    name = (name or "").strip()
    if not name:
        return None
    row = conn.execute(
        "SELECT customer_id FROM customers"
        " WHERE customer_id=? OR zalo_user_id=?", (name, name)).fetchone()
    return row["customer_id"] if row else None


def login(conn: sqlite3.Connection, name: str, password: str) -> LoginResult:
    """Check a password and open a session.

    Every failure says the same thing. Distinguishing "no such account"
    from "wrong password" turns the login form into a way to ask whether
    a given Zalo id uses this service.
    """
    customer_id = resolve_login_name(conn, name)
    if customer_id is None:
        return LoginResult(False, "bad_credentials")

    row = conn.execute(
        "SELECT password_hash, failed_logins, locked_until, status"
        "  FROM customers WHERE customer_id=?", (customer_id,)).fetchone()

    locked = row["locked_until"]
    if locked and locked > _stamp(_now()):
        return LoginResult(False, "locked")
    if row["status"] != "active":
        return LoginResult(False, "bad_credentials")

    if not verify_password(password, row["password_hash"]):
        failures = (row["failed_logins"] or 0) + 1
        until = None
        if failures >= MAX_ATTEMPTS:
            until = _stamp(_now() + timedelta(minutes=LOCKOUT_MINUTES))
            failures = 0
        conn.execute(
            "UPDATE customers SET failed_logins=?, locked_until=?"
            " WHERE customer_id=?", (failures, until, customer_id))
        return LoginResult(False, "locked" if until else "bad_credentials")

    token = secrets.token_urlsafe(SESSION_BYTES)
    conn.execute(
        "INSERT INTO sessions (token_hash, customer_id, created_at, expires_at)"
        " VALUES (?,?,?,?)",
        (_hash_token(token), customer_id, _stamp(_now()),
         _stamp(_now() + timedelta(days=SESSION_DAYS))),
    )
    now_iso = _stamp(_now())
    conn.execute(
        "UPDATE customers SET failed_logins=0, locked_until=NULL,"
        " last_login_at=?, login_count=COALESCE(login_count, 0) + 1"
        " WHERE customer_id=?", (now_iso, customer_id))
    try:
        conn.execute(
            "INSERT INTO activity_logs (customer_id, action, path, created_at)"
            " VALUES (?, 'login', '/api/auth/login', ?)",
            (customer_id, now_iso),
        )
    except Exception:
        pass
    return LoginResult(True, "ok", token=token, customer_id=customer_id)


def customer_for_token(conn: sqlite3.Connection, token: str) -> str | None:
    """Whose session this is, or None if it is expired or unknown."""
    if not token:
        return None
    row = conn.execute(
        "SELECT customer_id, expires_at FROM sessions WHERE token_hash=?",
        (_hash_token(token),)).fetchone()
    if row is None:
        return None
    if row["expires_at"] <= _stamp(_now()):
        conn.execute("DELETE FROM sessions WHERE token_hash=?",
                     (_hash_token(token),))
        return None
    return row["customer_id"]


def logout(conn: sqlite3.Connection, token: str) -> None:
    conn.execute("DELETE FROM sessions WHERE token_hash=?", (_hash_token(token),))


def purge_expired(conn: sqlite3.Connection) -> int:
    """Housekeeping. Expired rows are dead weight, not a safety net."""
    cursor = conn.execute("DELETE FROM sessions WHERE expires_at <= ?",
                          (_stamp(_now()),))
    return cursor.rowcount
