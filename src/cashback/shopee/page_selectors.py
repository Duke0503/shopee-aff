"""Page selectors for the Shopee affiliate dashboard.

Kept in one file on purpose. When Shopee changes the page this is the only
thing that needs editing -- no rebuild, no reinstalling the extension.

Discovered on 2026-09-10 with `cashback probe`. Re-run that command and diff
probe.json against this file whenever the script stops working.
"""

from __future__ import annotations

CUSTOM_LINK_URL = "https://affiliate.shopee.vn/offer/custom_link"

# One source URL per line. The page states a limit of five.
SOURCE_TEXTAREA = ".custom-textarea > textarea"

# Sub_id1 through Sub_id5.
SUB_ID_FIELDS = [f"#customLink_sub_id{n}" for n in range(1, 6)]

# The submit button is matched by its label rather than a class chain: antd
# regenerates those classes, but the wording is stable and human-visible.
SUBMIT_BUTTON_TEXT = r"l.y link"

# Where the generated link lands. It is a disabled textarea, so it is read
# through .value rather than .innerText.
RESULT_FIELD = "textarea.ant-input.ant-input-disabled"


# --- Limits the page itself imposes -----------------------------------

# "vui long dien toi da 5 lien ket trong cac hang khac nhau"
# What the page accepts in one submission.
MAX_LINKS_PER_SUBMIT = 5

# What this system actually sends. One, deliberately.
#
# Filling five at a time costs two things the speed was never worth:
#
#   sub_id cannot vary within a submission, so a chunk of five gets
#   sub_id1 (the customer) and no sub_id2 (the request). Reconciliation
#   can then say an order belongs to C0003 but not which of their five
#   links produced it.
#
#   five urls in, five links out, matched by POSITION -- an order
#   nothing in the page promises to keep.
#
# One url per submission makes both problems disappear rather than
# guarding against them. It costs about three seconds per extra link,
# and only when one customer sends several at once.
LINKS_PER_SUBMIT = 1

# "Chi duoc phep nhap gia tri chu va so (a-z,A-Z, 0-9)"
# No dashes, no underscores, no dots. Identifiers must respect this or the
# attribution that pays customers silently breaks.
SUB_ID_PATTERN = r"^[A-Za-z0-9]+$"

# The whole form carries ONE set of sub_ids, shared by every URL in the
# textarea. Two customers therefore cannot share a submission: their orders
# would come back indistinguishable in the conversion report.
SUB_IDS_ARE_SHARED_PER_SUBMIT = True
