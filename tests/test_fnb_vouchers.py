from pathlib import Path
from cashback.ledger import repository as ledger

def test_fnb_vouchers_crud(tmp_path: Path):
    db_file = tmp_path / "test_fnb.db"
    ledger.initialise(db_file)
    with ledger.connect(db_file) as conn:
        seeded = ledger.seed_fnb_vouchers_if_empty(conn)
        assert seeded >= 8
        all_v = ledger.get_fnb_vouchers(conn)
        assert len(all_v) >= 8

        hl_v = ledger.get_fnb_vouchers(conn, brand="highlands")
        assert len(hl_v) >= 4
        assert all(v["brand"] == "highlands" for v in hl_v)

        tch_v = ledger.get_fnb_vouchers(conn, brand="thecoffeehouse")
        assert len(tch_v) >= 4
        assert all(v["brand"] == "thecoffeehouse" for v in tch_v)

        counter_v = ledger.get_fnb_vouchers(conn, voucher_type="counter")
        assert len(counter_v) >= 6

        # Add a custom voucher
        new_id = ledger.upsert_fnb_voucher(
            conn,
            brand="highlands",
            title="Freeze Trà Xanh Giảm 15K",
            voucher_type="counter",
            code="FREEZE15K",
            discount_text="Giảm 15K",
            is_hot=1,
        )
        assert new_id > 0
        item = ledger.get_fnb_voucher_by_id(conn, new_id)
        assert item is not None
        assert item["code"] == "FREEZE15K"
        assert item["is_hot"] == 1
