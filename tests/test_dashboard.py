"""The payout console: the JSON it serves, and the two actions on it.

The JSON is a contract with the browser, so its shape is pinned here
rather than left to whatever the React app happens to read today. The
actions are not a contract, they are consequences: one sends a real
message to a real person, the other records that money left the account.

The HTTP layer is tested too. It was not, and it is the only part of
this system that parses input from outside the process.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request

import pytest

from cashback.core import accounts
from cashback.ledger import repository as ledger
from cashback.web import dashboard

RATE = 0.80


def _approved(conn, order_id: str, customer_id: str, cashback: int,
              request_id: str | None = None):
    ledger.add_order(conn, order_id, customer_id, request_id,
                     order_value=100_000, estimated_commission=cashback)
    ledger.mark_approved(conn, order_id, cashback * 2, cashback)


@pytest.fixture
def populated(conn, db):
    ledger.add_customer(conn, "C0001", display_name="Xuan Phuoc",
                        zalo_user_id="u1", private_chat_id="u1")
    ledger.set_bank_details(conn, "C0001", "VCB", "0123456789", "NGUYEN A")
    ledger.record_link_request(conn, "R00000000001", "C0001",
                               "https://shopee.vn/product/1/2", None, 9_000, "zalo")
    ledger.attach_affiliate_url(conn, "R00000000001",
                                "https://s.shopee.vn/aff1", 9_000)
    _approved(conn, "O1", "C0001", 40_000, "R00000000001")
    _approved(conn, "O2", "C0001", 21_000)

    ledger.add_customer(conn, "C0002", display_name="Chua Gui STK",
                        zalo_user_id="u2", private_chat_id="u2")
    _approved(conn, "O3", "C0002", 88_000)

    # Well under the old 50,000 threshold. It is payable now.
    ledger.add_customer(conn, "C0003", display_name="Rat It Tien",
                        zalo_user_id="u3", private_chat_id="u3")
    ledger.set_bank_details(conn, "C0003", "TCB", "9876543210", "TRAN B")
    _approved(conn, "O4", "C0003", 6_131)
    conn.commit()
    return db


def _cfg(db_path):
    """A config object with just what the dashboard actions read."""
    from cashback.core.config import load
    cfg = load()
    object.__setattr__(cfg, "db_path", db_path)
    return cfg


class TestThereIsNoMinimumAnyMore:
    """A 50,000 VND floor used to hold small balances back.

    It was a rule the customer could not see or influence, and it made
    every message about money explain a policy instead of a payment.
    When a balance is sent is now the operator's decision alone.
    """

    def test_a_balance_of_six_thousand_is_ready_to_pay(self, populated):
        ready = dashboard.snapshot(populated, RATE)["ready"]
        assert "C0003" in [p["customer_id"] for p in ready]

    def test_the_only_thing_that_blocks_a_transfer_is_a_missing_account(
            self, populated):
        data = dashboard.snapshot(populated, RATE)
        assert [p["customer_id"] for p in data["no_bank"]] == ["C0002"]
        assert all(p["has_bank"] for p in data["ready"])

    def test_no_figure_is_a_distance_from_a_threshold(self, populated):
        blob = json.dumps(dashboard.snapshot(populated, RATE))
        assert "short" not in blob
        assert "threshold" not in blob


class TestTheSnapshotShape:
    def test_totals_add_up_to_what_is_owed(self, populated):
        totals = dashboard.snapshot(populated, RATE)["totals"]
        # 61,000 (C0001) + 88,000 (C0002) + 6,131 (C0003)
        assert totals["owed"] == 155_131
        assert totals["ready"] + totals["no_bank"] == totals["owed"]
        assert totals["owed_customers"] == 3

    def test_a_payable_carries_its_orders_and_their_links(self, populated):
        ready = dashboard.snapshot(populated, RATE)["ready"]
        entry = next(p for p in ready if p["customer_id"] == "C0001")
        assert len(entry["orders"]) == 2
        assert any(o["affiliate_url"] == "https://s.shopee.vn/aff1"
                   for o in entry["orders"])

    def test_a_payable_carries_a_qr_and_a_reference(self, populated):
        entry = next(p for p in dashboard.snapshot(populated, RATE)["ready"]
                     if p["customer_id"] == "C0001")
        assert "img.vietqr.io" in entry["qr_url"]
        assert entry["reference"].endswith("C0001")

    def test_it_is_plain_json_not_dataclasses(self, populated):
        """The browser is the only consumer, so nothing may need repr()."""
        json.dumps(dashboard.snapshot(populated, RATE))

    def test_an_unmatched_bank_name_yields_no_qr_rather_than_a_guess(
            self, conn, db):
        ledger.add_customer(conn, "C0008", display_name="Ngan Hang La",
                            private_chat_id="u8")
        ledger.set_bank_details(conn, "C0008", "Ngan hang khong ton tai",
                                "111", "A")
        _approved(conn, "O8", "C0008", 30_000)
        conn.commit()
        entry = dashboard.snapshot(db, RATE)["ready"][0]
        assert entry["qr_url"] is None
        assert entry["bank_account"] == "111"    # shown for a manual transfer


class TestThePipelineIsVisible:
    """A console showing only what is payable is blank on most days.

    Three real orders worth 12,287 VND of commission were in flight and
    the page said nothing, which reads as "nothing is happening".
    """

    @pytest.fixture
    def awaiting(self, conn, db):
        ledger.add_customer(conn, "C0003", display_name="Xuan Phuoc",
                            private_chat_id="u1")
        ledger.record_link_request(conn, "R00000000001", "C0003",
                                   "https://shopee.vn/x", None, 5_522, "zalo")
        ledger.attach_affiliate_url(conn, "R00000000001",
                                    "https://s.shopee.vn/aff1", 5_522)
        conn.execute(
            "UPDATE link_requests SET estimate_detail=? WHERE request_id=?",
            ('{"commission":5522,"price":73631,"total_rate":7.5,'
             '"shopee_rate":2.5,"seller_rate":5.0,"shopee_part":1841,'
             '"seller_part":3682,"is_capped":false,'
             '"name":"Tui Trang Diem Dung Tich Lon","source":"shopee"}',
             "R00000000001"))
        ledger.add_order(conn, "2609141J5XWTHY", "C0003", "R00000000001",
                         order_value=73_631, estimated_commission=5_522)
        conn.commit()
        return db

    def test_awaiting_orders_appear(self, awaiting):
        assert len(dashboard.snapshot(awaiting, RATE)["pipeline"]) == 1

    def test_the_figure_shown_is_the_customers_share_not_the_commission(
            self, awaiting):
        row = dashboard.snapshot(awaiting, RATE)["pipeline"][0]
        assert row["estimated_commission"] == 5_522
        assert row["cashback"] == 4_418          # 80%, halves upward

    def test_it_names_the_product_and_carries_the_link(self, awaiting):
        row = dashboard.snapshot(awaiting, RATE)["pipeline"][0]
        assert "Tui Trang Diem" in row["product"]
        assert row["affiliate_url"] == "https://s.shopee.vn/aff1"

    def test_it_is_never_counted_as_owed(self, awaiting):
        """Nothing here is payable. The owed total must stay zero."""
        totals = dashboard.snapshot(awaiting, RATE)["totals"]
        assert totals["owed"] == 0
        assert totals["pipeline"] == 4_418


class TestMarkPaid:
    def test_it_records_the_transfer(self, populated):
        result = dashboard.mark_paid(_cfg(populated), "C0001", ["O1", "O2"])
        assert result["ok"] is True
        assert "C0001" not in [
            p["customer_id"]
            for p in dashboard.snapshot(populated, RATE)["ready"]]

    def test_paying_twice_is_refused(self, populated):
        cfg = _cfg(populated)
        dashboard.mark_paid(cfg, "C0001", ["O1", "O2"])
        assert dashboard.mark_paid(cfg, "C0001", ["O1", "O2"])["ok"] is False

    def test_an_injected_id_is_rejected(self, populated):
        result = dashboard.mark_paid(_cfg(populated), "C0001'; DROP TABLE--", [])
        assert result["ok"] is False

    def test_order_ids_are_filtered_too(self, populated):
        result = dashboard.mark_paid(
            _cfg(populated), "C0001", ["O1'; DELETE FROM orders--"])
        assert result["ok"] is False
        assert dashboard.snapshot(populated, RATE)["ready"]   # nothing touched


class TestAskForBank:
    def test_a_customer_with_no_private_chat_is_refused(self, conn, db):
        ledger.add_customer(conn, "C0007", display_name="No Chat")
        conn.commit()
        assert dashboard.ask_for_bank(_cfg(db), "C0007")["ok"] is False

    def test_an_unknown_customer_is_refused(self, db):
        assert dashboard.ask_for_bank(_cfg(db), "C9999")["ok"] is False

    def test_an_injected_id_is_rejected(self, db):
        assert dashboard.ask_for_bank(_cfg(db), "../../etc")["ok"] is False


class TestEveryLabelUsedExists:
    """A missing label prints its own key at the operator.

    The rewrite dropped four of them, and a failed transfer answered
    with the literal text "paid_failed", which says nothing.
    """

    def test_python_side_labels_are_all_defined(self):
        import re
        from pathlib import Path

        source = Path(dashboard.__file__).read_text(encoding="utf-8")
        used = set(re.findall(r'\bt\(\s*"([a-z0-9_]+)"', source))
        missing = used - set(dashboard.labels())
        assert not missing, f"missing from dashboard.vi.json: {sorted(missing)}"


class TestOverHTTP:
    """The only part of this system that parses input from outside.

    It binds to loopback and has no authentication, which is defensible
    only while it stays on loopback -- so the guards that do exist are
    the ones that matter: no path escapes the static directory, and no
    action route accepts an id the system did not issue.
    """

    @pytest.fixture
    def server(self, populated):
        srv = dashboard.serve_in_background(_cfg(populated), port=0)
        yield f"http://127.0.0.1:{srv.server_address[1]}"
        srv.shutdown()
        srv.server_close()

    def _get(self, url: str):
        with urllib.request.urlopen(url, timeout=5) as response:
            return response.status, response.read()

    def _post(self, url: str, body: dict):
        request = urllib.request.Request(
            url, data=json.dumps(body).encode(),
            headers={"Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(request, timeout=5) as response:
            return json.loads(response.read())

    def test_the_snapshot_is_served_as_json(self, server):
        status, body = self._get(f"{server}/api/payouts")
        assert status == 200
        assert json.loads(body)["totals"]["owed"] == 155_131

    def test_payouts_refuses_external_proxied_requests(self, server):
        request = urllib.request.Request(
            f"{server}/api/payouts",
            headers={"CF-Connecting-IP": "203.0.113.195"})
        with pytest.raises(urllib.error.HTTPError) as caught:
            with urllib.request.urlopen(request, timeout=5):
                pass
        assert caught.value.code == 403

    def test_labels_are_served_from_the_same_file_the_bot_reads(self, server):
        _, body = self._get(f"{server}/api/labels")
        assert json.loads(body)["title"] == dashboard.labels()["title"]

    def test_an_unknown_api_route_is_a_404_not_the_app(self, server):
        with pytest.raises(urllib.error.HTTPError) as caught:
            self._get(f"{server}/api/nope")
        assert caught.value.code == 404

    def test_a_path_climbing_out_of_static_cannot_read_the_disk(self, server):
        """It falls back to the app rather than serving .env."""
        _, body = self._get(f"{server}/../../../.env")
        assert b"ZALO" not in body and b"TOKEN" not in body

    def test_marking_paid_over_http_settles_the_orders(self, server, populated):
        result = self._post(f"{server}/api/customers/C0001/paid",
                            {"order_ids": ["O1", "O2"]})
        assert result["ok"] is True
        assert "C0001" not in [
            p["customer_id"]
            for p in dashboard.snapshot(populated, RATE)["ready"]]

    def test_a_body_that_is_not_a_list_of_ids_is_refused(self, server):
        request = urllib.request.Request(
            f"{server}/api/customers/C0001/paid",
            data=b'{"order_ids": "O1"}',
            headers={"Content-Type": "application/json"}, method="POST")
        with pytest.raises(urllib.error.HTTPError) as caught:
            urllib.request.urlopen(request, timeout=5)
        assert caught.value.code == 400

    def test_a_malformed_body_does_not_crash_the_handler(self, server):
        request = urllib.request.Request(
            f"{server}/api/customers/C0001/paid", data=b"not json at all",
            headers={"Content-Type": "application/json"}, method="POST")
        with pytest.raises(urllib.error.HTTPError) as caught:
            urllib.request.urlopen(request, timeout=5)
        assert caught.value.code == 400


class TestCustomerBankOverHTTP:
    @pytest.fixture
    def server_with_auth(self, populated):
        with ledger.connect(populated) as conn:
            pwd = accounts.issue_password(conn, "C0001")
            res = accounts.login(conn, "C0001", pwd)
            conn.commit()
        srv = dashboard.serve_in_background(_cfg(populated), port=0)
        yield f"http://127.0.0.1:{srv.server_address[1]}", res.token, populated
        srv.shutdown()
        srv.server_close()

    def test_bank_update_requires_auth(self, server_with_auth):
        base, _, _ = server_with_auth
        req = urllib.request.Request(
            f"{base}/api/me/bank",
            data=json.dumps({"bank_name": "VCB", "bank_account": "12345678", "account_holder": "A"}).encode(),
            headers={"Content-Type": "application/json"}, method="POST")
        with pytest.raises(urllib.error.HTTPError) as caught:
            urllib.request.urlopen(req, timeout=5)
        assert caught.value.code == 401

    def test_bank_update_succeeds_with_auth(self, server_with_auth):
        base, token, db = server_with_auth
        req = urllib.request.Request(
            f"{base}/api/me/bank",
            data=json.dumps({
                "bank_name": "Techcombank",
                "bank_account": "1903-123456-789",
                "account_holder": "NGUYEN VAN A"
            }).encode(),
            headers={
                "Content-Type": "application/json",
                "Cookie": f"cashback_session={token}",
            },
            method="POST")
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read())
        assert data["ok"] is True
        assert data["bank_name"] == "Techcombank"
        assert data["bank_account_tail"] == "***6789"

        with ledger.connect(db) as conn:
            cust = ledger.get_customer(conn, "C0001")
            assert cust["bank_name"] == "Techcombank"
            assert cust["bank_account"] == "1903123456789"
            assert cust["account_holder"] == "NGUYEN VAN A"

    def test_bank_erase_removes_details(self, server_with_auth):
        base, token, db = server_with_auth
        req = urllib.request.Request(
            f"{base}/api/me/bank/erase",
            data=b"{}",
            headers={
                "Content-Type": "application/json",
                "Cookie": f"cashback_session={token}",
            },
            method="POST")
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read())
        assert data["ok"] is True

        with ledger.connect(db) as conn:
            cust = ledger.get_customer(conn, "C0001")
            assert cust["bank_name"] is None
            assert cust["bank_account"] is None


class TestTheFrontendHasNoWordingOfItsOwn:
    """Same rule as the Python side: nothing a reader sees is in source.

    The currency mark slipped into a TypeScript file once, which is how
    a second copy of the wording starts -- and the two copies disagree
    the first time one of them is edited.
    """

    def _web_sources(self):
        from pathlib import Path
        from cashback.core.config import PROJECT_ROOT

        root = PROJECT_ROOT / "web" / "src"
        return list(root.rglob("*.ts")) + list(root.rglob("*.tsx"))

    def test_no_vietnamese_text_in_the_app_source(self):
        import unicodedata

        offenders = []
        for path in self._web_sources():
            for number, line in enumerate(
                    path.read_text(encoding="utf-8").splitlines(), 1):
                if any(ord(c) > 127 and "LATIN" in unicodedata.name(c, "")
                       for c in line):
                    offenders.append(f"{path.name}:{number}")
        assert not offenders, f"wording in source: {offenders}"

    def test_icons_come_from_one_place(self):
        """react-icons bundles twenty families; mixing them is what makes
        an app look like nobody decided anything. One set, imported once."""
        direct = [p.name for p in self._web_sources()
                  if "lucide-react" in p.read_text(encoding="utf-8")
                  and p.name != "icons.ts"]
        assert not direct, f"importing icons directly: {direct}"

    def test_the_currency_mark_is_a_label(self):
        assert dashboard.labels()["currency"]
        assert dashboard.labels()["thousands_separator"]

    def test_every_label_the_app_asks_for_exists(self):
        """A key with no label renders as the key itself.

        On the landing page that means a visitor reads "home_hero_title"
        where the headline should be -- and nothing crashes, so it ships.
        """
        import re

        used = set()
        for path in self._web_sources():
            source = path.read_text(encoding="utf-8")
            used |= set(re.findall(r'\bt\(\s*"([a-z0-9_]+)"', source))
            # Keys built from a loop counter, as in `t(`home_how_${n}_title`)`
            for prefix, suffix in re.findall(
                    r'\bt\(\s*`([a-z0-9_]+)\$\{[^}]+\}([a-z0-9_]*)`', source):
                used |= {key for key in dashboard.labels()
                         if key.startswith(prefix) and key.endswith(suffix)}

        missing = sorted(used - set(dashboard.labels()))
        assert not missing, f"missing from dashboard.vi.json: {missing}"

    def test_colour_is_used_through_tokens_not_raw_values(self):
        """A colour written inline in one component is a colour that
        does not change when the theme does -- and a state that reads
        differently on two screens is worse than one that reads dully on
        both."""
        offenders = []
        for path in self._web_sources():
            if path.name == "icon-chip.tsx":
                continue                      # the tone table itself
            for number, line in enumerate(
                    path.read_text(encoding="utf-8").splitlines(), 1):
                if "var(--" in line and "--ring" not in line:
                    offenders.append(f"{path.name}:{number}")
        assert not offenders, f"raw colour in a component: {offenders}"


class TestShopeeEndpointsOverHTTP:
    @pytest.fixture
    def server(self, populated):
        srv = dashboard.serve_in_background(_cfg(populated), port=0)
        yield f"http://127.0.0.1:{srv.server_address[1]}", populated
        srv.shutdown()
        srv.server_close()

    def test_preview_invalid_url_returns_400(self, server):
        base, _ = server
        req = urllib.request.Request(
            f"{base}/api/shopee/preview",
            data=json.dumps({"url": "https://google.com"}).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with pytest.raises(urllib.error.HTTPError) as caught:
            urllib.request.urlopen(req, timeout=5)
        assert caught.value.code == 400

    def test_convert_requires_customer_id(self, server):
        base, _ = server
        req = urllib.request.Request(
            f"{base}/api/shopee/convert",
            data=json.dumps({"url": "https://s.shopee.vn/test123"}).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with pytest.raises(urllib.error.HTTPError) as caught:
            urllib.request.urlopen(req, timeout=5)
        assert caught.value.code == 400

    def test_convert_and_link_status(self, server):
        base, db = server
        req = urllib.request.Request(
            f"{base}/api/shopee/convert",
            data=json.dumps({
                "url": "https://s.shopee.vn/test999",
                "customer_id": "C0001",
            }).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read())
        assert data["ok"] is True
        assert "request_id" in data

        # Check status endpoint
        status_req = urllib.request.Request(f"{base}/api/shopee/link-status?request_id={data['request_id']}")
        with urllib.request.urlopen(status_req, timeout=5) as resp:
            status_data = json.loads(resp.read())
        assert status_data["ok"] is True
        assert status_data["ready"] is False
