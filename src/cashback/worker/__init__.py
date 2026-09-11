"""Background work: batching link requests and driving the browser.

Requests are held for a window and released together, so a burst of
customers costs one browser pass instead of one each. That pacing is also
what keeps the account below Shopee's traffic thresholds.
"""
