"""The record of what is owed and what was paid.

`repository` owns the schema and every write; `metrics` reads it. The one
rule the whole business rests on lives here: cashback is paid from the
commission Shopee approved, never from an estimate shown earlier.
"""
