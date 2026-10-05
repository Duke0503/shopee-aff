import re
import pytest
import sqlite3
from cashback.core import banks
from cashback.ledger import repository as ledger

def test_enhanced_bank_find():
    assert banks.find("MB")["shortName"] == "MBBank"
    assert banks.find("mbbank")["shortName"] == "MBBank"
    assert banks.find("VCB")["shortName"] == "Vietcombank"
    assert banks.find("vietcombank")["shortName"] == "Vietcombank"
    assert banks.find("Techcombank")["shortName"] == "Techcombank"
    assert banks.find("tcb")["shortName"] == "Techcombank"
    assert banks.find("Vietinbank")["shortName"] == "VietinBank"
    assert banks.find("ctg")["shortName"] == "VietinBank"
    assert banks.find("Agribank")["shortName"] == "Agribank"
    assert banks.find("BIDV")["shortName"] == "BIDV"
    assert banks.find("TPBank")["shortName"] == "TPBank"
    assert banks.find("Sacombank")["shortName"] == "Sacombank"
    assert banks.find("lienvietpostbank")["shortName"] == "LPBank"
    assert banks.find("cake")["shortName"] == "CAKE"
    assert banks.find("timo")["shortName"] == "Timo"
    assert banks.find("viettel money")["shortName"] == "ViettelMoney"

def test_parse_bank_messages():
    # Multi-line structured
    msg1 = "Stk: 1053518375\nNgân hàng: Vietcombank\nChủ tài khoản: NGUYEN THI QUYNH ANH"
    res1 = banks.parse_bank_message(msg1, "Quynh Anh")
    assert res1["action"] == "valid"
    assert res1["bank_name"] == "Vietcombank"
    assert res1["bank_account"] == "1053518375"
    assert res1["account_holder"] == "NGUYEN THI QUYNH ANH"

    # Single line with dashes
    msg2 = "STK: 0866532458 - BIDV - DO MINH DUC"
    res2 = banks.parse_bank_message(msg2, "Minh Duc")
    assert res2["action"] == "valid"
    assert res2["bank_name"] == "BIDV"
    assert res2["bank_account"] == "0866532458"
    assert res2["account_holder"] == "DO MINH DUC"

    # Command /stk
    msg3 = "/stk 0976543911 MB Bank VU QUYNH ANH"
    res3 = banks.parse_bank_message(msg3, "Quynh Anh")
    assert res3["action"] == "valid"
    assert res3["bank_name"] == "MBBank"
    assert res3["bank_account"] == "0976543911"
    assert res3["account_holder"] == "VU QUYNH ANH"

    # Bare command /stk -> help/query
    res4 = banks.parse_bank_message("/stk", "User")
    assert res4["action"] == "help"

    # Partial info (digits only)
    res5 = banks.parse_bank_message("STK: 5300205813110", "User")
    assert res5["action"] == "partial"
    assert res5["account"] == "5300205813110"

    # Bank only
    res_bank = banks.parse_bank_message("Agribank", "User")
    assert res_bank["action"] == "bank_only"
    assert res_bank["bank_name"] == "Agribank"

    # Holder only
    res_holder = banks.parse_bank_message("Chủ tài khoản: NONG THE VINH", "User")
    assert res_holder["action"] == "holder_only"
    assert res_holder["holder"] == "NONG THE VINH"

    # Non-bank message
    res6 = banks.parse_bank_message("Xin chao bot", "User")
    assert res6 is None

def test_bot_update_bank_in_ledger(db):
    with ledger.connect(db) as conn:
        conn.execute("""
            INSERT INTO customers (customer_id, zalo_user_id, display_name, role, status, created_at)
            VALUES ('test_cust_1', 'test_cust_1', 'Quỳnh Anh', 'user', 'active', datetime('now'))
        """)
        conn.commit()

        # Update bank details via parsed text
        msg = "Stk: 1053518375\nNgân hàng: Vietcombank\nChủ tài khoản: NGUYEN THI QUYNH ANH"
        parsed = banks.parse_bank_message(msg, "Quỳnh Anh")
        assert parsed["action"] == "valid"

        ledger.set_bank_details(
            conn, "test_cust_1", parsed["bank_name"], parsed["bank_account"], parsed["account_holder"]
        )
        conn.commit()

        cust = ledger.get_customer(conn, "test_cust_1")
        assert cust["bank_name"] == "Vietcombank"
        assert cust["bank_account"] == "1053518375"
        assert cust["account_holder"] == "NGUYEN THI QUYNH ANH"

        # Sequential update: customer later updates holder name
        msg_holder = "Chủ TK: NGUYEN THI QUYNH ANH VIP"
        parsed_holder = banks.parse_bank_message(msg_holder)
        assert parsed_holder["action"] == "holder_only"
        assert parsed_holder["holder"] == "NGUYEN THI QUYNH ANH VIP"

        ledger.set_bank_details(
            conn, "test_cust_1", cust["bank_name"], cust["bank_account"], parsed_holder["holder"]
        )
        conn.commit()

        cust_updated = ledger.get_customer(conn, "test_cust_1")
        assert cust_updated["account_holder"] == "NGUYEN THI QUYNH ANH VIP"
