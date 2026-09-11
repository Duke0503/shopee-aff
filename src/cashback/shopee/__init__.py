"""Everything that touches Shopee.

    browser_bridge      loopback HTTP link to the helper extension
    page_selectors      what to click, discovered by probing
    link_generator      drives the Custom Link page
    page_prober         dumps a page structure when selectors break
    commission          one way to ask "what is this worth", two sources
    dashboard_lookup    Shopee's own data, preferred
    third_party_lookup  fallback when the dashboard has no answer
    report_importer     reads the exported conversion report
    reconciliation      matches report rows back to link requests

Shopee has no usable API for this account (see
docs/04-reference/shopee-api-findings.md), so the dashboard is driven
through a real logged-in browser rather than called directly.
"""
