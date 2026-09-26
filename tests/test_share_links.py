"""Short links on our own domain: /s/<code> -> the affiliate link.

A purchase made after tapping an affiliate link inside Zalo's in-app
browser is not credited. Our link is not a Shopee link to Zalo, so the
customer reaches our page first: a real browser is redirected, an in-app
one is shown how to get out, and a preview bot gets the product card.
"""

from __future__ import annotations

import http.client
import json
import re
from datetime import timedelta

import pytest

from cashback.ledger import repository as ledger
from cashback.ledger import share_links
from cashback.messaging import notifications
from cashback.web import dashboard, share_page

AFF = "https://s.shopee.vn/aff123"
BASE = "https://example.test"
DESKTOP = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128.0 Safari/537.36"
ANDROID_CHROME = "Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 Chrome/128.0 Mobile Safari/537.36"
ZALO_IOS = ("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15"
            " (KHTML, like Gecko) Mobile/15E148 Zalo iOS/24.08.01 ZaloTheme/light ZaloLanguage/vn")
ZALO_ANDROID = ("Mozilla/5.0 (Linux; Android 14; SM-A546E Build/UP1A; wv) AppleWebKit/537.36"
                " (KHTML, like Gecko) Version/4.0 Chrome/128.0 Mobile Safari/537.36 Zalo android/12345")
PREVIEW_BOT = "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)"


def _request(conn, request_id="R26092600001", affiliate=AFF, detail=None):
    ledger.add_customer(conn, "111", zalo_user_id="111", private_chat_id="111")
    ledger.record_link_request(conn, request_id, "111", "https://shopee.vn/x", None, 5_000, "zalo")
    if affiliate:
        ledger.attach_affiliate_url(conn, request_id, affiliate, 5_000)
    if detail:
        conn.execute("UPDATE link_requests SET estimate_detail=? WHERE request_id=?",
                     (json.dumps(detail), request_id))
    return request_id


class TestCodes:
    def test_one_code_per_request_made_once(self, conn):
        rid = _request(conn)
        code = share_links.code_for(conn, rid)
        assert re.fullmatch(r"[A-Za-z0-9]{8}", code)
        assert share_links.code_for(conn, rid) == code

    def test_codes_differ_between_requests(self, conn):
        _request(conn)
        ledger.record_link_request(conn, "R26092600002", "111", "https://shopee.vn/y", None, 1, "zalo")
        assert share_links.code_for(conn, "R26092600001") != share_links.code_for(conn, "R26092600002")

    def test_unknown_request_and_sharing_off(self, conn):
        rid = _request(conn)
        assert share_links.code_for(conn, "R00000000000") is None
        assert share_links.url_for(conn, "", rid) is None
        assert share_links.url_for(conn, BASE + "/", rid) == f"{BASE}/s/{share_links.code_for(conn, rid)}"

    def test_a_code_without_a_link_leads_nowhere(self, conn):
        rid = _request(conn, affiliate=None)
        code = share_links.code_for(conn, rid)
        assert share_links.find(conn, code) is None
        assert share_links.find(conn, "bad-code") is None


class TestWhoIsAsking:
    @pytest.mark.parametrize("ua,kind", [
        (DESKTOP, "browser"), (ANDROID_CHROME, "browser"),
        (ZALO_IOS, "in_app"), (ZALO_ANDROID, "in_app"),
        (PREVIEW_BOT, "bot"), ("", "bot"), ("curl/8.0", "bot"),
    ])
    def test_classify(self, ua, kind):
        assert share_page.classify(ua) == kind


@pytest.fixture
def server(db):
    dashboard._limiter = dashboard._RateLimiter()
    from cashback.core.config import load
    cfg = load()
    object.__setattr__(cfg, "db_path", db)
    object.__setattr__(cfg, "public_base_url", BASE)
    srv = dashboard.serve_in_background(cfg, port=0)
    yield srv.server_address[1]
    srv.shutdown()
    srv.server_close()


def _get(port, path, ua, internet=True):
    c = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
    headers = {"User-Agent": ua}
    if internet:
        headers["CF-Connecting-IP"] = "203.0.113.7"
    c.request("GET", path, headers=headers)
    r = c.getresponse()
    return r.status, dict(r.getheaders()), r.read().decode("utf-8")


def _clicks(db):
    with ledger.connect(db) as conn:
        return [r[0] for r in conn.execute("SELECT agent FROM link_clicks ORDER BY id")]


DETAIL = {"name": "Tu Giay Thong Minh", "image_url": "https://cf.shopee.vn/file/abc",
          "price": 199_000, "shopee_rate": 2.5, "shopee_part": 4_975,
          "cashback": 3_543, "rate_percent": "80%"}


@pytest.fixture
def code(db):
    with ledger.connect(db) as conn:
        rid = _request(conn, detail=DETAIL)
        return share_links.code_for(conn, rid)


def _buy_href(page):
    import html as _html
    return _html.unescape(re.search(r'<a class="(?:btn|ghost)" href="([^"]+)" rel="nofollow"', page).group(1))


class TestTheProductPage:
    def test_everyone_sees_the_product_first(self, server, db, code):
        status, _, page = _get(server, f"/s/{code}", DESKTOP)
        assert status == 200
        assert "Tu Giay Thong Minh" in page and "https://cf.shopee.vn/file/abc" in page
        assert "199.000" in page and "3.543" in page and "4.975" in page
        assert _clicks(db) == ["browser"]

    def test_the_buy_button_goes_through_go_to_the_affiliate_link(self, server, db, code):
        page = _get(server, f"/s/{code}", DESKTOP)[2]
        assert _buy_href(page) == f"{BASE}/s/{code}/go"
        status, headers, _ = _get(server, f"/s/{code}/go", DESKTOP)
        assert status == 302 and headers["Location"] == AFF
        assert _clicks(db) == ["browser", "buy"]

    def test_in_zalo_on_android_the_button_opens_chrome(self, server, db, code):
        page = _get(server, f"/s/{code}", ZALO_ANDROID)[2]
        href = _buy_href(page)
        assert href.startswith(f"intent://example.test/s/{code}/go#Intent;scheme=https;"
                               "package=com.android.chrome")
        assert "S.browser_fallback_url=https%3A%2F%2Fexample.test%2Fs%2F" in href
        assert f'href="{BASE}/s/{code}/go"' in page          # "buy here anyway"
        assert 'id="hint"' not in page
        assert _clicks(db) == ["in_app"]

    def test_in_zalo_on_iphone_the_button_tries_safari_and_the_menu_is_pointed_at(self, server, db, code):
        page = _get(server, f"/s/{code}", ZALO_IOS)[2]
        assert _buy_href(page) == f"x-safari-{BASE}/s/{code}/go"
        assert 'class="hint" id="hint"' in page

    def test_the_button_comes_before_the_campaign_and_the_details(self, server, db, code):
        from cashback.ledger import campaigns
        with ledger.connect(db) as conn:
            campaigns.create(conn, "t", "Trung Thu", "2026-01-01T00:00:00+07:00",
                             "2099-01-01T00:00:00+07:00", 20, 20_000)
        page = _get(server, f"/s/{code}", DESKTOP)[2]
        body = page[page.index("<body"):]
        assert body.index('class="cash"') < body.index('class="cta"') < body.index('class="event"')
        assert body.index('class="event"') < body.index("<details>")

    def test_a_preview_bot_gets_the_card_and_is_not_a_click(self, server, db, code):
        status, _, page = _get(server, f"/s/{code}", PREVIEW_BOT)
        assert status == 200 and 'og:title" content="Tu Giay Thong Minh"' in page
        assert _get(server, f"/s/{code}/go", PREVIEW_BOT)[0] == 302
        assert _clicks(db) == []

    def test_unknown_or_unsafe_codes_are_404(self, server, db, code):
        assert _get(server, "/s/AAAAAAAA", DESKTOP)[0] == 404
        assert _get(server, "/s/AAAAAAAA/go", DESKTOP)[0] == 404
        assert _get(server, "/s/../../etc", DESKTOP)[0] == 404
        with ledger.connect(db) as conn:
            conn.execute("UPDATE link_requests SET affiliate_url='javascript:alert(1)'")
        assert _get(server, f"/s/{code}", DESKTOP)[0] == 404
        assert _get(server, f"/s/{code}/go", DESKTOP)[0] == 404
        assert _clicks(db) == []

    def test_every_word_on_the_page_comes_from_the_labels(self, server, code):
        words = dashboard.labels()
        page = _get(server, f"/s/{code}", ZALO_IOS)[2]
        for key in ("open_brand", "open_cashback_label", "open_tips_title", "open_tip_1",
                    "open_breakdown_title", "open_veil_ios"):
            assert __import__("html").escape(words[key]) in page, key
        assert words["open_buy"].replace("{platform}", "Shopee") in page

    def test_a_link_without_figures_finds_them_in_the_product_cache(self, server, db):
        with ledger.connect(db) as conn:
            ledger.add_customer(conn, "111", zalo_user_id="111")
            ledger.record_link_request(conn, "R26092600007", "111",
                                       "https://shopee.vn/product/166586877/10096389022", None, 1, "zalo")
            ledger.attach_affiliate_url(conn, "R26092600007", AFF, 1)
            ledger.upsert_product_cache(conn, item_id="10096389022", name="Ke De Giay",
                                        price=250_000, price_formatted="250.000d",
                                        cashback=7_000, cashback_formatted="7.000d")
            code = share_links.code_for(conn, "R26092600007")
        page = _get(server, f"/s/{code}", DESKTOP)[2]
        assert "Ke De Giay" in page and "250.000d" in page and "7.000d" in page
        with ledger.connect(db) as conn:     # kept, so the next visit is a plain read
            detail = json.loads(conn.execute("SELECT estimate_detail FROM link_requests"
                                             " WHERE request_id='R26092600007'").fetchone()[0])
        assert detail["name"] == "Ke De Giay"

    def test_a_house_link_promises_no_cashback(self, server, db):
        with ledger.connect(db) as conn:
            ledger.record_link_request(conn, "R26092600008", ledger.HOUSE_CUSTOMER_ID,
                                       "https://shopee.vn/x", None, 1, "web")
            ledger.attach_affiliate_url(conn, "R26092600008", AFF, 1)
            conn.execute("UPDATE link_requests SET estimate_detail=? WHERE request_id='R26092600008'",
                         (json.dumps(DETAIL),))
            code = share_links.code_for(conn, "R26092600008")
        words = dashboard.labels()
        page = _get(server, f"/s/{code}", DESKTOP)[2]
        assert words["open_house_title"] in page and words["open_zalo_url"] in page
        assert "3.543" not in page

    def test_a_running_campaign_is_mentioned(self, server, db, code, monkeypatch):
        from cashback.ledger import campaigns
        with ledger.connect(db) as conn:
            campaigns.create(conn, "t", "Trung Thu", "2026-01-01T00:00:00+07:00",
                             "2099-01-01T00:00:00+07:00", 20, 20_000)
        page = _get(server, f"/s/{code}", DESKTOP)[2]
        assert "Trung Thu" in page and "20.000" in page

    def test_link_status_hands_out_the_short_link(self, server, db, code):
        status, _, body = _get(server, "/api/shopee/link-status?request_id=R26092600001",
                               DESKTOP, internet=False)
        data = json.loads(body)
        assert data["affiliate_url"] == AFF
        assert data["share_url"] == f"{BASE}/s/{code}"


class TestLateLinkMessages:
    @pytest.fixture(autouse=True)
    def no_wait(self, monkeypatch):
        notifications._backoff.clear()
        monkeypatch.setattr(notifications, "ASSISTANT_WAIT", timedelta(seconds=-1))

    class Bot:
        def __init__(self):
            self.sent = []

        def send(self, uid, text):
            self.sent.append((uid, text))

    def test_the_message_carries_the_short_link(self, db):
        with ledger.connect(db) as conn:
            rid = _request(conn)
        bot = self.Bot()
        notifications.deliver_ready_links(db, bot, 0.8, "30-70 ngay",
                                          third_party=False, share_base=BASE)
        with ledger.connect(db) as conn:
            code = share_links.code_for(conn, rid)
        [(_, text)] = bot.sent
        assert f"{BASE}/s/{code}" in text and AFF not in text

    def test_without_a_base_the_affiliate_link_goes_out_as_before(self, db):
        with ledger.connect(db) as conn:
            _request(conn)
        bot = self.Bot()
        notifications.deliver_ready_links(db, bot, 0.8, "30-70 ngay", third_party=False)
        [(_, text)] = bot.sent
        assert AFF in text


class TestWhatTheAssistantGets:
    PRODUCT = "https://shopee.vn/product/166586877/10096389022"

    def _post(self, port, path, body):
        c = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
        c.request("POST", path, body=json.dumps(body),
                  headers={"Content-Type": "application/json"})
        return json.loads(c.getresponse().read())

    def test_a_link_reused_from_cache_comes_with_its_short_link(self, server, db):
        with ledger.connect(db) as conn:
            ledger.add_customer(conn, "111", zalo_user_id="111")
            ledger.record_link_request(conn, "R26092600009", "111", self.PRODUCT, None, 5_000, "zalo")
            ledger.attach_affiliate_url(conn, "R26092600009", AFF, 5_000)
            ledger.upsert_product_cache(conn, item_id="10096389022", shop_id="166586877",
                                        name="X", price=100_000, shopee_rate=5.0,
                                        shopee_part=5_000, total_commission=5_000,
                                        cashback=3_600)
        data = self._post(server, "/api/shopee/smart-resolve",
                          {"url": self.PRODUCT, "customer_id": "111"})
        assert data["affiliate_url"] == AFF
        with ledger.connect(db) as conn:
            code = share_links.code_for(conn, "R26092600009")
        assert data["share_url"] == f"{BASE}/s/{code}"

    def test_a_head_request_is_not_a_click(self, server, db, code):
        c = http.client.HTTPConnection("127.0.0.1", server, timeout=10)
        c.request("HEAD", f"/s/{code}/go", headers={"User-Agent": DESKTOP})
        assert c.getresponse().status == 302
        assert _clicks(db) == []
