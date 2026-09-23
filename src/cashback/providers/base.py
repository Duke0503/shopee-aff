from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any, Optional


@dataclass
class ProductPreview:
    platform: str
    item_id: str
    name: str
    image_url: Optional[str]
    price: int
    price_formatted: str
    commission_rate: float
    raw_commission: int
    commission_formatted: str
    net_commission: int
    cashback_amount: int
    cashback_formatted: str
    is_capped: bool
    canonical_url: str
    source_rate_info: Optional[dict[str, Any]] = None


@dataclass
class AffiliateLinkResult:
    platform: str
    request_id: str
    affiliate_url: Optional[str]
    is_ready: bool
    product_preview: Optional[ProductPreview] = None
    cached: bool = False
    error: Optional[str] = None


@dataclass
class NormalizedOrder:
    order_id: str
    platform: str
    customer_id: str
    request_id: Optional[str]
    order_value: int
    estimated_commission: int
    approved_commission: Optional[int]
    status: str  # 'awaiting_approval' | 'approved' | 'rejected'
    rejection_reason: Optional[str]
    order_time: Optional[str]


class BaseAffiliateProvider(ABC):
    @property
    @abstractmethod
    def platform_name(self) -> str:
        """Name of the platform ('shopee', 'tiktok', etc.)."""
        pass

    @abstractmethod
    def match_url(self, url: str) -> bool:
        """Check if the URL belongs to this platform."""
        pass

    @abstractmethod
    def normalize_url(self, url: str) -> str:
        """Normalize URL (resolve short links, remove tracking noise)."""
        pass

    @abstractmethod
    def preview(self, url: str, advertised_rate: float) -> Optional[ProductPreview]:
        """Look up product info and calculate cashback estimate."""
        pass

    @abstractmethod
    def create_link(
        self,
        url: str,
        customer_id: str,
        request_id: str,
        conn: Any,
        advertised_rate: float,
    ) -> AffiliateLinkResult:
        """Create affiliate tracking link with customer SubIDs."""
        pass

    @abstractmethod
    def parse_orders(self, raw_data: Any) -> list[NormalizedOrder]:
        """Parse orders data (CSV or API response) into NormalizedOrder objects."""
        pass
