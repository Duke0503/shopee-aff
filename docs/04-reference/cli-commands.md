# Tham chiếu lệnh

> Sinh từ chính parser trong `cli/app.py`. Đừng sửa tay — sửa code rồi sinh lại.

## `cashback init`

## `cashback status`

## `cashback check-policy`

| Tham số | Mặc định | Ý nghĩa |
|---|---|---|
| `--monthly-commission` | `9000000` |  |
| `--sample-commission` | `27000` |  |

## `cashback metrics`

| Tham số | Mặc định | Ý nghĩa |
|---|---|---|
| `--withheld` | - | assume the payout period was withheld at 10%% |

## `cashback payouts`

## `cashback pay`

| Tham số | Mặc định | Ý nghĩa |
|---|---|---|
| `order_id` | - |  |
| `--note` | `` |  |

## `cashback expire`

## `cashback audit`

| Tham số | Mặc định | Ý nghĩa |
|---|---|---|
| `--customer` | - | show everything one customer did |
| `--scan` | - | list accounts worth a second look before paying |
| `--archive` | - | compress closed months to save disk |
| `--months` | `3` |  |

## `cashback bridge`

| Tham số | Mặc định | Ý nghĩa |
|---|---|---|
| `--port` | - |  |
| `--window` | - | batch window seconds |
| `--max-size` | - |  |

## `cashback setup-token`

## `cashback probe`

| Tham số | Mặc định | Ý nghĩa |
|---|---|---|
| `--url` | `https://affiliate.shopee.vn/offer/custom_link` |  |
| `--port` | - |  |
| `--wait` | `3000` | ms to let the page settle |
| `--connect-timeout` | `30` |  |
| `--save` | `probe.json` | write the raw dump here |

## `cashback add-customer`

| Tham số | Mặc định | Ý nghĩa |
|---|---|---|
| `--id` | - | omit to allocate the next one |
| `--name` | `` |  |
| `--zalo-id` | `` |  |
| `--chat-id` | `` | private chat id, needed to notify |
| `--bank` | `` |  |
| `--account` | `` |  |
| `--holder` | `` |  |

## `cashback request`

| Tham số | Mặc định | Ý nghĩa |
|---|---|---|
| `customer_id` | - |  |
| `url` | - |  |
| `--channel` | `direct` |  |
| `--force` | - | queue even if not ready |

## `cashback forget`

| Tham số | Mặc định | Ý nghĩa |
|---|---|---|
| `who` | - | customer id, Zalo id, or part of their name |
| `--force` | - | erase even if a payout is still owed |

## `cashback reset`

| Tham số | Mặc định | Ý nghĩa |
|---|---|---|
| `--yes` | - |  |

## `cashback links`

| Tham số | Mặc định | Ý nghĩa |
|---|---|---|
| `--limit` | `20` |  |

## `cashback run`

| Tham số | Mặc định | Ý nghĩa |
|---|---|---|
| `--port` | - |  |
| `--window` | - | batch window seconds |
| `--max-size` | - |  |
| `--connect-timeout` | `45` |  |

## `cashback zalo-check`

| Tham số | Mặc định | Ý nghĩa |
|---|---|---|
| `--seconds` | - | 0 (default) listens until Ctrl+C |

## `cashback serve`

| Tham số | Mặc định | Ý nghĩa |
|---|---|---|
| `--port` | - |  |
| `--window` | - | batch window seconds |
| `--max-size` | - |  |
| `--connect-timeout` | `45` |  |
| `--no-browser` | - | Zalo side only; queue links but do not generate them |

## `cashback inspect-report`

| Tham số | Mặc định | Ý nghĩa |
|---|---|---|
| `file` | - |  |

## `cashback reconcile`

| Tham số | Mặc định | Ý nghĩa |
|---|---|---|
| `file` | - |  |
| `--withheld` | - | this payout period was withheld at 10%% |
| `--dry-run` | - | parse and show, change nothing |

## `cashback sync-accesstrade`

| Tham số | Mặc định | Ý nghĩa |
|---|---|---|
| `--days` | `30` | số ngày gần nhất cần đồng bộ đơn hàng AccessTrade TikTok Shop |

