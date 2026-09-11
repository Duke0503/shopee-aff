"""Configuration loaded from .env.

Every credential is optional. With none set the system still runs: Shopee
calls fall back to a simulator and Zalo messages print to stdout.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from .policy import TaxPolicy

PROJECT_ROOT = Path(__file__).resolve().parents[2]


def _load_dotenv() -> None:
    """Minimal .env reader so the package needs no extra dependency."""
    path = PROJECT_ROOT / ".env"
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip())


@dataclass(frozen=True)
class Config:
    shopee_app_id: str
    shopee_secret: str
    shopee_api_url: str
    zalo_bot_token: str
    zalo_api_url: str
    cashback_rate: float
    tax_policy: TaxPolicy
    link_attribution_days: int
    auto_payout: bool
    db_path: Path
    bridge_port: int
    bridge_token: str
    batch_window_seconds: int
    batch_max_size: int
    third_party_fallback: bool

    @property
    def has_shopee_credentials(self) -> bool:
        return bool(self.shopee_app_id and self.shopee_secret)

    @property
    def has_zalo_credentials(self) -> bool:
        return bool(self.zalo_bot_token)

    def describe_mode(self) -> str:
        shopee = "live" if self.has_shopee_credentials else "SIMULATED (no credentials)"
        zalo = "live" if self.has_zalo_credentials else "STDOUT (no token)"
        return f"Shopee: {shopee}  |  Zalo: {zalo}"

    @property
    def advertised_cashback_rate(self) -> float:
        """What customers actually receive, which is what you may advertise.

        Under USER_ABSORBS the withholding comes out of the customer's
        cashback, so the honest figure is lower than `cashback_rate`.
        """
        if self.tax_policy is TaxPolicy.USER_ABSORBS:
            from .policy import WITHHOLDING_TAX_RATE

            return self.cashback_rate - WITHHOLDING_TAX_RATE
        return self.cashback_rate


def load() -> Config:
    _load_dotenv()
    raw_policy = os.getenv("TAX_POLICY", TaxPolicy.OWNER_ABSORBS.value).strip().lower()
    try:
        tax_policy = TaxPolicy(raw_policy)
    except ValueError:
        valid = ", ".join(p.value for p in TaxPolicy)
        raise SystemExit(f"TAX_POLICY must be one of: {valid} (got {raw_policy!r})")

    return Config(
        shopee_app_id=os.getenv("SHOPEE_APP_ID", "").strip(),
        shopee_secret=os.getenv("SHOPEE_SECRET", "").strip(),
        shopee_api_url=os.getenv(
            "SHOPEE_API_URL", "https://open-api.affiliate.shopee.vn/graphql"
        ).strip(),
        zalo_bot_token=os.getenv("ZALO_BOT_TOKEN", "").strip(),
        zalo_api_url=os.getenv(
            "ZALO_API_URL", "https://bot-api.zaloplatforms.com"
        ).strip(),
        cashback_rate=float(os.getenv("CASHBACK_RATE", "0.80")),
        tax_policy=tax_policy,
        link_attribution_days=int(os.getenv("LINK_ATTRIBUTION_DAYS", "7")),
        auto_payout=os.getenv("AUTO_PAYOUT", "true").lower() in ("1", "true", "yes"),
        db_path=Path(os.getenv("DB_PATH", "./cashback.db")),
        bridge_port=int(os.getenv("BRIDGE_PORT", "8787")),
        bridge_token=os.getenv("BRIDGE_TOKEN", "").strip(),
        batch_window_seconds=int(os.getenv("BATCH_WINDOW_SECONDS", "150")),
        batch_max_size=int(os.getenv("BATCH_MAX_SIZE", "20")),
        third_party_fallback=os.getenv(
            "THIRD_PARTY_FALLBACK", "true"
        ).strip().lower() in ("1", "true", "yes"),
    )
