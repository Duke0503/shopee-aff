from __future__ import annotations

import re
from typing import Optional
from .base import BaseAffiliateProvider


class ProviderRegistry:
    def __init__(self) -> None:
        self._providers: dict[str, BaseAffiliateProvider] = {}

    def register(self, provider: BaseAffiliateProvider) -> None:
        self._providers[provider.platform_name] = provider

    def get_by_name(self, name: str) -> Optional[BaseAffiliateProvider]:
        return self._providers.get(name.lower().strip())

    def detect_provider(self, url: str) -> Optional[BaseAffiliateProvider]:
        """Detect which provider handles the given product URL."""
        if not url:
            return None
        clean_url = str(url).strip()
        for provider in self._providers.values():
            if provider.match_url(clean_url):
                return provider
        return None

    def all_providers(self) -> list[BaseAffiliateProvider]:
        return list(self._providers.values())


_GLOBAL_REGISTRY: Optional[ProviderRegistry] = None


def get_registry() -> ProviderRegistry:
    global _GLOBAL_REGISTRY
    if _GLOBAL_REGISTRY is None:
        _GLOBAL_REGISTRY = ProviderRegistry()
        _register_builtin_providers(_GLOBAL_REGISTRY)
    return _GLOBAL_REGISTRY


def _register_builtin_providers(registry: ProviderRegistry) -> None:
    try:
        from .shopee_provider import ShopeeProvider
        registry.register(ShopeeProvider())
    except ImportError:
        pass

    try:
        from .tiktok_provider import TikTokAccessTradeProvider
        registry.register(TikTokAccessTradeProvider())
    except ImportError:
        pass

    try:
        from .lazada_provider import LazadaAccessTradeProvider
        registry.register(LazadaAccessTradeProvider())
    except ImportError:
        pass

    try:
        from .shopeefood_provider import ShopeeFoodProvider
        registry.register(ShopeeFoodProvider())
    except ImportError:
        pass
