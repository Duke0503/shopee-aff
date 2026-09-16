"""Letting a customer see their own ledger.

Two things are being protected here, and they pull in opposite
directions. A customer who cannot get in writes off the money; a
stranger who does get in reads someone's orders and the tail of their
bank account. The bot resolves it: it already knows the one fact that
matters, which is who controls which Zalo account.

The rule these tests exist to hold is that asking for a password is a
RESET, never a reminder. Competing tools re-send the current password,
which means they can read it, which means it is stored recoverably.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request

import pytest

from cashback.core import accounts
from cashback.ledger import repository as ledger
from cashback.web import dashboard


@pytest.fixture
def customer(conn, db):
    ledger.add_customer(conn, "C0001", display_name="Xuan Phuoc",
                        zalo_user_id="8421550739", private_chat_id="8421550739")
    conn.commit()
    return db


def _cfg(db_path):
    from cashback.core.config import load
    cfg = load()
    object.__setattr__(cfg, "db_path", db_path)
    return cfg


class TestPasswordsAreNotRecoverable:
    def test_what_is_stored_is_not_the_password(self, conn, customer):
        password = accounts.issue_password(conn, "C0001")
        stored = conn.execute(
            "SELECT password_hash FROM customers WHERE customer_id='C0001'"
        ).fetchone()["password_hash"]
        assert password not in stored
        assert stored.startswith("pbkdf2$")

    def test_asking_again_issues_a_new_one(self, conn, customer):
        """A reminder would mean the password can be read back."""
        first = accounts.issue_password(conn, "C0001")
        second = accounts.issue_password(conn, "C0001")
        assert first != second

    def test_the_old_password_stops_working_immediately(self, conn, customer):
        first = accounts.issue_password(conn, "C0001")
        accounts.issue_password(conn, "C0001")
        assert accounts.login(conn, "C0001", first).ok is False

    def test_a_reset_ends_sessions_opened_with_the_old_one(self, conn, customer):
        """A reset that leaves old sessions alive is not a reset."""
        first = accounts.issue_password(conn, "C0001")
        session = accounts.login(conn, "C0001", first)
        assert accounts.customer_for_token(conn, session.token) == "C0001"
        accounts.issue_password(conn, "C0001")
        assert accounts.customer_for_token(conn, session.token) is None

    def test_a_password_is_not_derived_from_the_customer(self):
        """If it can be computed from the id, knowing the id is enough."""
        assert len({accounts.new_password() for _ in range(200)}) > 190

    def test_an_unknown_customer_gets_nothing(self, conn, db):
        assert accounts.issue_password(conn, "C9999") is None


class TestSigningIn:
    def test_the_issued_password_works(self, conn, customer):
        password = accounts.issue_password(conn, "C0001")
        assert accounts.login(conn, "C0001", password).ok

    def test_the_zalo_id_works_too(self, conn, customer):
        """It is the number a customer actually recognises."""
        password = accounts.issue_password(conn, "C0001")
        assert accounts.login(conn, "8421550739", password).ok

    def test_a_wrong_password_is_refused(self, conn, customer):
        accounts.issue_password(conn, "C0001")
        assert accounts.login(conn, "C0001", "WRONG123").ok is False

    def test_an_unknown_name_fails_the_same_way_as_a_wrong_password(
            self, conn, customer):
        """Otherwise the form answers "does this Zalo id use the service"."""
        accounts.issue_password(conn, "C0001")
        assert (accounts.login(conn, "C9999", "WHATEVER1").reason
                == accounts.login(conn, "C0001", "WRONG123").reason)

    def test_a_customer_with_no_password_cannot_be_signed_into(
            self, conn, customer):
        assert accounts.login(conn, "C0001", "").ok is False

    def test_guessing_repeatedly_locks_the_account(self, conn, customer):
        password = accounts.issue_password(conn, "C0001")
        for _ in range(accounts.MAX_ATTEMPTS):
            accounts.login(conn, "C0001", "WRONG123")
        # Even the right password is refused while the lockout holds.
        assert accounts.login(conn, "C0001", password).reason == "locked"

    def test_a_good_login_clears_the_failure_count(self, conn, customer):
        password = accounts.issue_password(conn, "C0001")
        for _ in range(accounts.MAX_ATTEMPTS - 1):
            accounts.login(conn, "C0001", "WRONG123")
        assert accounts.login(conn, "C0001", password).ok
        assert conn.execute(
            "SELECT failed_logins FROM customers WHERE customer_id='C0001'"
        ).fetchone()["failed_logins"] == 0


class TestSessions:
    def test_the_token_itself_is_never_stored(self, conn, customer):
        password = accounts.issue_password(conn, "C0001")
        token = accounts.login(conn, "C0001", password).token
        rows = conn.execute("SELECT token_hash FROM sessions").fetchall()
        assert token not in [r["token_hash"] for r in rows]

    def test_an_unknown_token_belongs_to_nobody(self, conn, customer):
        assert accounts.customer_for_token(conn, "made-up") is None
        assert accounts.customer_for_token(conn, "") is None

    def test_an_expired_session_is_refused_and_cleaned_up(self, conn, customer):
        password = accounts.issue_password(conn, "C0001")
        token = accounts.login(conn, "C0001", password).token
        conn.execute("UPDATE sessions SET expires_at='2000-01-01T00:00:00+00:00'")
        assert accounts.customer_for_token(conn, token) is None
        assert conn.execute("SELECT COUNT(*) FROM sessions").fetchone()[0] == 0

    def test_logging_out_ends_it(self, conn, customer):
        password = accounts.issue_password(conn, "C0001")
        token = accounts.login(conn, "C0001", password).token
        accounts.logout(conn, token)
        assert accounts.customer_for_token(conn, token) is None


class TestChangingPassword:
    def test_it_works_with_the_current_one(self, conn, customer):
        password = accounts.issue_password(conn, "C0001")
        ok, _ = accounts.change_password(conn, "C0001", password, "chosen-one")
        assert ok
        assert accounts.login(conn, "C0001", "chosen-one").ok

    def test_the_current_password_is_required(self, conn, customer):
        accounts.issue_password(conn, "C0001")
        ok, reason = accounts.change_password(conn, "C0001", "WRONG123", "chosen-one")
        assert not ok and reason == "wrong_password"

    def test_a_short_replacement_is_refused(self, conn, customer):
        password = accounts.issue_password(conn, "C0001")
        ok, reason = accounts.change_password(conn, "C0001", password, "abc")
        assert not ok and reason == "too_short"


class TestWhatACustomerCanSee:
    @pytest.fixture
    def with_orders(self, conn, customer):
        ledger.set_bank_details(conn, "C0001", "VCB", "0123456789", "NGUYEN A")
        ledger.add_order(conn, "O1", "C0001", None, order_value=100_000,
                         estimated_commission=9_263)
        ledger.add_order(conn, "O2", "C0001", None, order_value=200_000,
                         estimated_commission=20_000)
        ledger.mark_approved(conn, "O2", 20_000, 16_000)
        ledger.add_customer(conn, "C0002", display_name="Nguoi Khac")
        ledger.add_order(conn, "O9", "C0002", None, order_value=500_000,
                         estimated_commission=50_000)
        ledger.mark_approved(conn, "O9", 50_000, 40_000)
        conn.commit()
        return customer

    def test_it_shows_their_own_orders(self, with_orders):
        data = dashboard.my_orders(with_orders, "C0001", 0.80)
        assert {o["order_id"] for o in data["orders"]} == {"O1", "O2"}

    def test_it_shows_nobody_elses(self, with_orders):
        data = dashboard.my_orders(with_orders, "C0001", 0.80)
        assert "O9" not in [o["order_id"] for o in data["orders"]]

    def test_an_unsettled_order_is_marked_as_an_estimate(self, with_orders):
        data = dashboard.my_orders(with_orders, "C0001", 0.80)
        pending = next(o for o in data["orders"] if o["order_id"] == "O1")
        assert pending["is_estimate"] is True
        assert pending["cashback"] == 7_410     # 80% of the estimate

    def test_a_settled_order_shows_the_real_figure(self, with_orders):
        data = dashboard.my_orders(with_orders, "C0001", 0.80)
        settled = next(o for o in data["orders"] if o["order_id"] == "O2")
        assert settled["is_estimate"] is False
        assert settled["cashback"] == 16_000

    def test_the_bank_account_is_never_returned_in_full(self, with_orders):
        """Enough to recognise the account, never enough to reuse it."""
        data = dashboard.my_orders(with_orders, "C0001", 0.80)
        assert "0123456789" not in json.dumps(data)
        assert data["bank_account_tail"] == "***6789"


class TestOverHTTP:
    @pytest.fixture
    def server(self, conn, customer):
        ledger.add_order(conn, "O1", "C0001", None, order_value=100_000,
                         estimated_commission=9_263)
        password = accounts.issue_password(conn, "C0001")
        conn.commit()
        srv = dashboard.serve_in_background(_cfg(customer), port=0)
        yield f"http://127.0.0.1:{srv.server_address[1]}", password
        srv.shutdown()
        srv.server_close()

    def _post(self, url, body, cookie=""):
        headers = {"Content-Type": "application/json"}
        if cookie:
            headers["Cookie"] = cookie
        request = urllib.request.Request(
            url, data=json.dumps(body).encode(), headers=headers, method="POST")
        with urllib.request.urlopen(request, timeout=5) as response:
            return response, json.loads(response.read())

    def _get(self, url, cookie=""):
        request = urllib.request.Request(
            url, headers={"Cookie": cookie} if cookie else {})
        with urllib.request.urlopen(request, timeout=5) as response:
            return json.loads(response.read())

    def _sign_in(self, base, password) -> str:
        response, body = self._post(f"{base}/api/auth/login",
                                    {"name": "C0001", "password": password})
        assert body["ok"]
        return response.headers["Set-Cookie"].split(";")[0]

    def test_me_without_a_session_is_401_not_an_empty_page(self, server):
        base, _ = server
        with pytest.raises(urllib.error.HTTPError) as caught:
            self._get(f"{base}/api/me")
        assert caught.value.code == 401

    def test_signing_in_sets_an_httponly_session_cookie(self, server):
        base, password = server
        response, body = self._post(f"{base}/api/auth/login",
                                    {"name": "C0001", "password": password})
        assert body["ok"] is True
        cookie = response.headers["Set-Cookie"]
        assert "HttpOnly" in cookie and "SameSite=Strict" in cookie

    def test_a_signed_in_customer_reads_their_own_orders(self, server):
        base, password = server
        data = self._get(f"{base}/api/me", self._sign_in(base, password))
        assert data["customer_id"] == "C0001"
        assert [o["order_id"] for o in data["orders"]] == ["O1"]

    def test_a_wrong_password_is_401(self, server):
        base, _ = server
        with pytest.raises(urllib.error.HTTPError) as caught:
            self._post(f"{base}/api/auth/login",
                       {"name": "C0001", "password": "WRONG123"})
        assert caught.value.code == 401

    def test_logging_out_makes_the_cookie_useless(self, server):
        base, password = server
        cookie = self._sign_in(base, password)
        self._post(f"{base}/api/auth/logout", {}, cookie)
        with pytest.raises(urllib.error.HTTPError) as caught:
            self._get(f"{base}/api/me", cookie)
        assert caught.value.code == 401

    def test_changing_a_password_needs_a_session(self, server):
        base, _ = server
        with pytest.raises(urllib.error.HTTPError) as caught:
            self._post(f"{base}/api/auth/password",
                       {"current": "x", "replacement": "yyyyyyyy"})
        assert caught.value.code == 401

    def test_the_operator_endpoint_is_reachable_on_loopback(self, server):
        """These tests run on loopback, which is the only place it works."""
        base, _ = server
        assert "totals" in self._get(f"{base}/api/payouts")
