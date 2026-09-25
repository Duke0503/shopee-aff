"""Talking to customers on Zalo.

    assistant_bridge  sending through the Zalo assistant (zalo_assistant/)
    notifications     what the backend tells customers on its own initiative
    templates         wording, loaded from resources/messages.vi.json

Replies to what customers type are the assistant's job, not this package's.

No Vietnamese text belongs in this package: every customer-facing string
lives in the message file so it can be edited without touching code.
"""
