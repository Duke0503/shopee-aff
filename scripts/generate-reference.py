"""Regenerate the reference docs that are derived from code.

Run after changing the CLI parser or the database schema:
    uv run python scripts/generate-reference.py
"""
import re, subprocess, sys
from pathlib import Path
sys.path.insert(0, "C:/Project/mmo/src")

from cashback.cli.app import build_parser
from cashback.ledger import repository

out = ["# Tham chiếu lệnh", "",
       "> Sinh từ chính parser trong `cli/app.py`. Đừng sửa tay — sửa code rồi sinh lại.",
       ""]

parser = build_parser()
actions = [a for a in parser._actions if hasattr(a, "choices") and a.choices]
if actions:
    for name, sub in actions[0].choices.items():
        out.append(f"## `cashback {name}`")
        out.append("")
        if sub.description or sub.format_usage():
            desc = (sub.description or "").strip()
            if desc:
                out.append(desc)
                out.append("")
        opts = [a for a in sub._actions if a.dest != "help"]
        if opts:
            out.append("| Tham số | Mặc định | Ý nghĩa |")
            out.append("|---|---|---|")
            for a in opts:
                flags = ", ".join(f"`{o}`" for o in a.option_strings) or f"`{a.dest}`"
                default = "-" if a.default in (None, False) else f"`{a.default}`"
                out.append(f"| {flags} | {default} | {(a.help or '').strip()} |")
            out.append("")

Path("C:/Project/mmo/docs/04-reference/cli-commands.md").write_text(
    "\n".join(out) + "\n", encoding="utf-8")
print("cli-commands.md")

# --- schema
ddl = repository.SCHEMA if hasattr(repository, "SCHEMA") else None
src = Path("C:/Project/mmo/src/cashback/ledger/repository.py").read_text(encoding="utf-8")
tables = re.findall(r"CREATE TABLE IF NOT EXISTS (\w+) \((.*?)\n\);", src, re.S)

doc = ["# Lược đồ cơ sở dữ liệu", "",
       "> Sinh từ DDL trong `ledger/repository.py`.", "",
       "```mermaid", "erDiagram"]
rel = {
    "link_requests": [("customers", "customer_id")],
    "orders": [("customers", "customer_id"), ("link_requests", "request_id")],
}
for table, _ in tables:
    for other, key in rel.get(table, []):
        doc.append(f"    {other} ||--o{{ {table} : {key}")
doc += ["```", ""]

for table, body in tables:
    doc.append(f"## `{table}`")
    doc.append("")
    doc.append("| Cột | Kiểu | Ghi chú |")
    doc.append("|---|---|---|")
    for line in body.splitlines():
        line = line.strip().rstrip(",")
        if not line or line.startswith("--") or line.upper().startswith(("PRIMARY", "FOREIGN", "UNIQUE")):
            continue
        parts = line.split(None, 1)
        if len(parts) < 2:
            continue
        col, rest = parts
        note = []
        if "PRIMARY KEY" in rest: note.append("khoá chính")
        if "REFERENCES" in rest:
            note.append("→ " + re.search(r"REFERENCES (\w+)", rest).group(1))
        if "NOT NULL" in rest: note.append("bắt buộc")
        kind = rest.split()[0]
        doc.append(f"| `{col}` | {kind} | {', '.join(note)} |")
    doc.append("")

later = re.search(r"_LATER_COLUMNS = \{(.*?)\n\}", src, re.S)
if later:
    doc += ["## Cột thêm sau", "",
            "Thêm bằng cách khai ở `_LATER_COLUMNS`, **đừng sửa DDL** — `serve` tự chạy migration khi khởi động.",
            "", "```python", "_LATER_COLUMNS = {" + later.group(1) + "\n}", "```", ""]

Path("C:/Project/mmo/docs/04-reference/database-schema.md").write_text(
    "\n".join(doc) + "\n", encoding="utf-8")
print("database-schema.md")
