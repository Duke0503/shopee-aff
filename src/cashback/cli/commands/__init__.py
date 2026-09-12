"""One module per group of commands, grouped by what they operate on.

    ledger_ops  read or change the ledger
    analysis    answer a question, change nothing
    reports     Shopee's exported report, and reconciling it
    browser     drive, inspect, or set up the extension
    service     the long-running loops

`app.py` keeps only the parser and the dispatch table, so adding a command
means touching one command module and one line of the table.
"""
