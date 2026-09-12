"""Commands that drive, inspect, or set up the browser extension."""

from __future__ import annotations

import argparse
import sys

from ...core.config import Config
from ...ledger import repository as ledger
from ..formatting import _pct, _vnd


def cmd_bridge(cfg: Config, args: argparse.Namespace) -> int:
    from ...shopee.browser_bridge import Bridge, serve

    if not cfg.bridge_token:
        print("BRIDGE_TOKEN is empty. Set a long random value in .env first,")
        print("and the same value in extension/background/base_url.js.")
        print("Without it any local process could drive the extension.")
        return 1

    bridge = Bridge(
        token=cfg.bridge_token,
        hosts=["affiliate.shopee.vn"],
        landing_url="https://affiliate.shopee.vn/offer/custom_link",
    )
    serve(bridge, args.port or cfg.bridge_port)
    return 0


def cmd_setup_token(cfg: Config, args: argparse.Namespace) -> int:
    """Generate a bridge secret and write it to both places that need it.

    The bridge and the extension must agree on this value. Writing it by hand
    in two files invites a silent mismatch, which surfaces only as every
    request returning 401.
    """
    import re
    import secrets
    from pathlib import Path

    from ...core.config import PROJECT_ROOT

    token = secrets.token_urlsafe(48)

    env_path = PROJECT_ROOT / ".env"
    if not env_path.exists():
        print(f"{env_path} not found. Copy .env.example to .env first.")
        return 1

    env_text = env_path.read_text(encoding="utf-8")
    if re.search(r"^BRIDGE_TOKEN=.*$", env_text, flags=re.MULTILINE):
        env_text = re.sub(
            r"^BRIDGE_TOKEN=.*$", f"BRIDGE_TOKEN={token}", env_text,
            flags=re.MULTILINE,
        )
    else:
        env_text = env_text.rstrip("\n") + f"\nBRIDGE_TOKEN={token}\n"
    env_path.write_text(env_text, encoding="utf-8")

    js_path = PROJECT_ROOT / "extension" / "background" / "base_url.js"
    example = js_path.with_name("base_url.example.js")
    if not js_path.exists():
        if not example.exists():
            print(f"Neither {js_path} nor {example} exists.")
            return 1
        js_path.write_text(example.read_text(encoding="utf-8"), encoding="utf-8")
        print(f"Created {js_path.name} from the example.")

    js_text = js_path.read_text(encoding="utf-8")
    js_text, count = re.subn(
        r"^export const bridge_token = .*$",
        f"export const bridge_token = '{token}';",
        js_text,
        flags=re.MULTILINE,
    )
    if not count:
        print(f"No bridge_token line found in {js_path}. Left unchanged.")
        return 1
    js_path.write_text(js_text, encoding="utf-8")

    print("New bridge secret written to:")
    print(f"  {env_path}")
    print(f"  {js_path}")
    print("\nReload the extension in chrome://extensions for it to pick this up.")
    return 0


def cmd_probe(cfg: Config, args: argparse.Namespace) -> int:
    """Dump the structure of a dashboard page, so a script can be written."""
    import json as _json
    from pathlib import Path

    from ...shopee import page_prober as probe
    from ...shopee.browser_bridge import Bridge, serve_in_background

    if not cfg.bridge_token:
        print("BRIDGE_TOKEN is empty. Run: cashback setup-token")
        return 1

    bridge = Bridge(
        token=cfg.bridge_token,
        hosts=["affiliate.shopee.vn"],
        landing_url=CUSTOM_LINK_URL,
    )
    server = serve_in_background(bridge, args.port or cfg.bridge_port)
    print(f"Bridge up on 127.0.0.1:{args.port or cfg.bridge_port}. "
          "Waiting for the extension...")

    import time

    for _ in range(int(args.connect_timeout)):
        if bridge.connected():
            break
        time.sleep(1)
    else:
        server.shutdown()
        print("\nExtension never checked in. Things to verify:")
        print("  - loaded at chrome://extensions (Developer mode, Load unpacked)")
        print("  - Chrome is open")
        print("  - token matches: cashback setup-token, then Reload the extension")
        return 1

    print("Extension connected. Probing...\n")
    try:
        found = probe.run(bridge, args.url, wait_ms=args.wait)
    except RuntimeError as exc:
        print(f"Probe failed: {exc}")
        return 1
    finally:
        server.shutdown()

    # Save before printing. A console that cannot render the page's own
    # language must not cost us the dump we just spent 30 seconds collecting.
    if args.save:
        out = Path(args.save)
        out.write_text(_json.dumps(found, indent=2, ensure_ascii=False),
                       encoding="utf-8")
        print(f"Raw dump written to {out}\n")

    _print_safely(probe.report(found))
    return 0


def _bridge_for(cfg: Config):
    from ...shopee.browser_bridge import Bridge
    from ...shopee.page_selectors import CUSTOM_LINK_URL

    return Bridge(
        token=cfg.bridge_token,
        hosts=["affiliate.shopee.vn"],
        landing_url=CUSTOM_LINK_URL,
    )


def _print_safely(text: str) -> None:
    """Print text a legacy console may not be able to encode.

    Windows consoles often default to a codepage that cannot represent the
    page's own language. Losing the report to a UnicodeEncodeError would be
    absurd, so fall back to replacing what the console cannot draw.
    """
    try:
        print(text)
    except UnicodeEncodeError:
        encoding = sys.stdout.encoding or "ascii"
        sys.stdout.buffer.write(text.encode(encoding, errors="replace"))
        sys.stdout.buffer.write(b"\n")
        sys.stdout.flush()
        print(
            "\n(Some characters could not be drawn by this console. "
            "The saved JSON has them intact.)"
        )
