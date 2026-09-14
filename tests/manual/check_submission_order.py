"""Does Shopee return links in the order the URLs were submitted?

generate() maps links back to requests by POSITION -- zip(chunk, links).
Nothing in Shopee's page promises that order, so this checks it against
the real site: three unmistakably different products go in, and every
returned short link is followed to see which item it actually lands on.

Verified 2026-09-14: order held, 3/3.

This cannot live in the normal suite -- it needs a logged-in browser and
it touches Shopee. Run it by hand after any change to how the form is
filled or read, and after Shopee redesigns the Custom Link page.

    cashback serve must be STOPPED first; it holds the bridge port.
    uv run python tests/manual/check_submission_order.py
"""
import sys, time
sys.path.insert(0, "C:/Project/mmo/src")
import httpx
from cashback.core import config
from cashback.shopee import link_generator as gen
from cashback.shopee.browser_bridge import Bridge, serve_in_background
from cashback.shopee.dashboard_lookup import parse_url

cfg = config.load()
bridge = Bridge(token=cfg.bridge_token, hosts=["affiliate.shopee.vn"],
                landing_url=gen.CUSTOM_LINK_URL)
serve_in_background(bridge, cfg.bridge_port)
for _ in range(90):
    if bridge.connected(): break
    time.sleep(1)
print("bridge:", bridge.connected(), flush=True)

# Three clearly different products, submitted in this order.
PRODUCTS = [
    ("Ga Chong Tham",  "https://shopee.vn/product/166586877/10096389022"),
    ("Chuot G102",     "https://shopee.vn/product/1346334064/26971815798"),
    ("Honda SH125i",   "https://shopee.vn/product/228650443/43578070453"),
]
urls = [u for _, u in PRODUCTS]
wanted = [parse_url(u)[2] for u in urls]
print("gui theo thu tu:", [n for n, _ in PRODUCTS], flush=True)

gen.open_page(bridge, settle_ms=3000)
links = gen.convert_chunk(bridge, urls, ["C0001"])
print("nhan ve:", links, flush=True)

def item_of(short_url: str) -> str:
    try:
        with httpx.Client(follow_redirects=True, timeout=20) as c:
            final = str(c.get(short_url).url)
        p = parse_url(final)
        return p[2] if p else "?"
    except Exception as e:
        return f"loi: {e}"

print()
ok = True
for (name, _), link, want in zip(PRODUCTS, links, wanted):
    got = item_of(link)
    match = (got == want)
    ok = ok and match
    print(f"  {name:<16} muon item {want:<12} link tro toi {got:<12} {'DUNG' if match else '*** SAI ***'}")
print()
print("KET LUAN:", "thu tu duoc giu nguyen" if ok else "THU TU BI LON - ANH XA THEO VI TRI KHONG AN TOAN")
