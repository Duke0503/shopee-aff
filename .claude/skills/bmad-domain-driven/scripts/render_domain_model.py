#!/usr/bin/env python3
"""Render a BMAD domain-model.json into Mermaid Markdown and a static HTML explorer."""

from __future__ import annotations

import argparse
import html
import json
import re
from pathlib import Path
from typing import Any


def safe_id(value: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_]", "_", value)


def load_model(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def context_label(context: dict[str, Any]) -> str:
    aggregates = " · ".join(a["name"] for a in context.get("aggregates", []))
    label = context.get("label") or context["name"]
    return f"{label}<br/>{aggregates}" if aggregates else label


def render_context_map(model: dict[str, Any]) -> str:
    lines = ["# Context Map", "", "```mermaid", "flowchart LR"]
    for context in model.get("contexts", []):
        lines.append(f'    {safe_id(context["id"])}["{context_label(context)}"]')
    for relation in model.get("relations", []):
        source = safe_id(relation["from"])
        target = safe_id(relation["to"])
        via = relation.get("via") or relation["kind"].lower()
        marker = "-.->|" if relation["kind"] == "EVENT" else "-->|"
        lines.append(f"    {source} {marker}{relation['kind'].lower()}: {via}| {target}")
    lines.extend(["```", "", "Legend: `PORT` synchronous call, `EVENT` asynchronous fact, `REFERENCE` identifier link, `EXTERNAL` outside system."])
    return "\n".join(lines) + "\n"


def render_strategic_map(model: dict[str, Any]) -> str:
    lines = ["# Strategic Domain Map", ""]
    strategic = model.get("strategicModel", {})
    primary = strategic.get("primaryDomain")
    if primary:
        lines.extend([f"**Primary domain:** `{primary}`", ""])
    if strategic.get("classificationRationale"):
        lines.extend([strategic["classificationRationale"], ""])
    lines.extend(["```mermaid", "flowchart TB"])
    subdomains = strategic.get("subdomains", [])
    for subdomain in subdomains:
        node = safe_id(subdomain["id"])
        label = f"{subdomain['name']}<br/>{subdomain['domainType']}"
        lines.append(f'    {node}["{label}"]')
        for context_id in subdomain.get("contextIds", []):
            lines.append(f"    {node} --> {safe_id(context_id)}")
    for context in model.get("contexts", []):
        domain_type = context.get("domainType", "unknown")
        lines.append(f'    {safe_id(context["id"])}["{context["name"]}<br/>{domain_type}"]')
    lines.extend(["```", "", "## Classification", "", "| Subdomain | Type | Contexts | Description |", "|---|---|---|---|"])
    for subdomain in subdomains:
        lines.append(
            f"| `{subdomain['name']}` | `{subdomain['domainType']}` | "
            f"{', '.join(subdomain.get('contextIds', []))} | {subdomain.get('description', '')} |"
        )
    return "\n".join(lines) + "\n"


def render_aggregate_map(model: dict[str, Any]) -> str:
    """Global overview only — names and cross-aggregate relations. Per-aggregate detail
    (fields, invariants, identity, lifecycle) lives on each context's page in `contexts/`."""
    lines = [
        "# Aggregate Map",
        "",
        "Cross-context overview of every aggregate and how they call each other. For one",
        "aggregate's fields, invariants, identity, and lifecycle, open its context page in",
        "`contexts/`.",
        "",
        "```mermaid",
        "flowchart TB",
    ]
    for context in model.get("contexts", []):
        context_node = safe_id(f"context_{context['id']}")
        lines.append(f'    subgraph {context_node}["{context.get("label") or context["name"]}"]')
        for aggregate in context.get("aggregates", []):
            aggregate_node = safe_id(aggregate["id"])
            lines.append(f'        {aggregate_node}["{aggregate["name"]}"]')
        lines.append("    end")
    for relation in model.get("relations", []):
        if relation.get("fromAggregate") and relation.get("toAggregate"):
            lines.append(
                f'    {safe_id(relation["fromAggregate"])} -->|{relation.get("via") or relation["kind"].lower()}| '
                f'{safe_id(relation["toAggregate"])}'
            )
    lines.extend(["```", ""])
    return "\n".join(lines)


def render_event_flow(model: dict[str, Any]) -> str:
    lines = ["# Event Flow", "", "```mermaid", "flowchart LR"]
    for context in model.get("contexts", []):
        lines.append(f'    {safe_id(context["id"])}["{context.get("label") or context["name"]}"]')
        for event in context.get("events", []):
            event_node = safe_id(f"event_{event['id']}")
            lines.append(f'    {event_node}{{"{event["name"]}"}}')
            producer = event.get("producer")
            if producer:
                lines.append(f"    {safe_id(producer)} --> {event_node}")
            for consumer in event.get("consumers", []):
                lines.append(f"    {event_node} -.-> {safe_id(consumer)}")
    for relation in model.get("relations", []):
        if relation.get("kind") == "EVENT" and relation.get("from") and relation.get("to"):
            lines.append(f"    {safe_id(relation['from'])} -.->|{relation.get('via', 'event')}| {safe_id(relation['to'])}")
    lines.extend(["```", ""])
    return "\n".join(lines)


def render_cheatsheet(model: dict[str, Any]) -> str:
    lines = [f"# {model.get('application', 'Domain')} - Domain Cheat-Sheet", ""]
    if model.get("status"):
        lines.append(f"_Model status: `{model['status']}`._")
        lines.append("")
    lines.extend(["## Bounded Contexts", ""])
    for context in model.get("contexts", []):
        aggregates = ", ".join(a["name"] for a in context.get("aggregates", [])) or "none"
        lines.append(f"- **{context['name']}** - {context.get('description', '')} ({aggregates})")
    lines.extend(["", "## Context Relations", "", "| From | Kind | To | Via | Description |", "|---|---|---|---|---|"])
    for relation in model.get("relations", []):
        lines.append(
            f"| `{relation['from']}` | `{relation['kind']}` | `{relation['to']}` | "
            f"`{relation.get('via', '')}` | {relation.get('description', '')} |"
        )
    for context in model.get("contexts", []):
        lines.extend(["", f"## Context: {context['name']}", "", context.get("description", "")])
        for aggregate in context.get("aggregates", []):
            lines.extend(["", f"### {aggregate['name']}", "", aggregate.get("description", ""), ""])
            lines.extend(["| Field | Type | Required | References | Constraints |", "|---|---|---:|---|---|"])
            for field in aggregate.get("fields", []):
                constraints = ", ".join(field.get("constraints", []))
                lines.append(
                    f"| `{field['name']}` | `{field['type']}` | "
                    f"{'yes' if field.get('required') else ''} | `{field.get('references', '')}` | {constraints} |"
                )
            for rule in aggregate.get("rules", []):
                lines.append(f"- Rule `{rule['id']}`: {rule['description']}")
    lines.append("")
    return "\n".join(lines)


def _decision_date(d: dict[str, Any]) -> str:
    for src in d.get("sources", []) or []:
        m = re.search(r"(\d{4}-\d{2}-\d{2})", str(src))
        if m:
            return m.group(1)
    return ""


OQ_ID_RE = r"^oq-?(\d+)"
D_ID_RE = r"^d(\d+)"


def _code_of(obj_id: str, prefix_re: str, label: str) -> str:
    m = re.match(prefix_re, obj_id or "", re.I)
    return f"{label}{m.group(1)}" if m else obj_id


def render_qa(model: dict[str, Any]) -> str:
    """Q&A: every open question grouped by who must answer, then the decision log newest
    first. Same data as the Q&A view of the HTML page; the meeting works off this list and
    the answers go back into .context/decisions and the model, never into this file."""
    names = {c["id"]: c["name"] for c in model.get("contexts", [])}
    ctx = lambda ids: ", ".join(f"[{names.get(i, i)}](contexts/{i}.md)" for i in (ids or []))
    def num(x):
        m = re.search(r"(\d+)", x or "")
        return int(m.group(1)) if m else 0
    qs = sorted(model.get("openQuestions", []) or [], key=lambda q: -num(q.get("id")))
    ds = sorted(model.get("decisions", []) or [], key=lambda d: -num(d.get("id")))
    cell = lambda t: str(t or "").replace("|", "\\|").replace("\n", " ")
    lines = ["# Q&A: open questions and decision log", "",
             "Open questions are grouped by who must answer. Decisions are newest first. `proposed` means not yet signed off by the project owner.",
             "Decide in the meeting, then record the result in `.context/decisions/` and `docs/domain-model.json`. This file is generated only.", ""]
    def qtable(items, third):
        out = [f"| Code | Question | {third} | Context | Who answers | Status |", "|---|---|---|---|---|---|"]
        for q in items:
            out.append(f"| `{_code_of(q['id'], OQ_ID_RE, 'OQ')}` | {cell(q.get('question'))} | {cell(q.get('impact'))} | {ctx(q.get('contexts'))} | {cell(q.get('owner'))} | `{q.get('status', 'open')}` |")
        return out
    open_qs = [q for q in qs if q.get("status", "open") == "open"]
    by_owner: dict[str, list] = {}
    for q in open_qs:
        by_owner.setdefault(q.get("owner") or "unassigned", []).append(q)
    lines += [f"## Open questions ({len(open_qs)})", ""]
    for owner, items in sorted(by_owner.items(), key=lambda kv: -len(kv[1])):
        lines += [f"### {owner} ({len(items)})", ""] + qtable(items, "Impact") + [""]
    deferred = [q for q in qs if q.get("status") == "deferred"]
    if deferred:
        lines += [f"## Deferred ({len(deferred)})", ""] + qtable(deferred, "Reopen when") + [""]
    resolved = [q for q in qs if q.get("status") == "resolved"]
    if resolved:
        lines += [f"## Answered ({len(resolved)})", ""] + qtable(resolved, "Answer") + [""]
    def dtable(items):
        out = ["| Code | Date | Decision | Why | Context | Status |", "|---|---|---|---|---|---|"]
        for d in items:
            out.append(f"| `{_code_of(d['id'], D_ID_RE, 'D')}` | {_decision_date(d)} | {cell(d.get('decision'))} | {cell(((('Superseded by ' + _code_of(d['supersededBy'], D_ID_RE, 'D') + '. ') if d.get('supersededBy') else '') + (d.get('rationale') or '')))} | {ctx(d.get('contexts'))} | `{d.get('status', 'accepted')}` |")
        return out
    proposed = [d for d in ds if d.get("status") == "proposed"]
    accepted = [d for d in ds if d.get("status", "accepted") == "accepted"]
    rejected = [d for d in ds if d.get("status") in ("rejected", "superseded")]
    lines += [f"## Decisions ({len(ds)})", ""]
    if proposed:
        lines += [f"### Proposed, awaiting sign-off ({len(proposed)})", ""] + dtable(proposed) + [""]
    lines += [f"### Accepted ({len(accepted)})", ""] + dtable(accepted) + [""]
    if rejected:
        lines += [f"### Rejected or superseded ({len(rejected)})", ""] + dtable(rejected) + [""]
    return "\n".join(lines) + "\n"


def render_rule_catalog(model: dict[str, Any]) -> str:
    """Cross-cutting index, one row per rule, linking to its context page.

    Kept global on purpose: "show me every authorization rule in the domain" is a real
    question no single context page can answer. The full rule — plus the invariants and
    policy/specification blocks that sit next to it — lives on the context page under its
    "Rules & policies" facet; this table only indexes it.
    """
    anchor = FACET_SLUGS["rules"]
    lines = [
        "# Domain Rule Catalog",
        "",
        "One row per rule, across every context. This is an index, not the detail — follow",
        "the context link for the rule's neighbours (invariants, policies, who it binds).",
        "",
        "| Context | Aggregate | Rule | Kind | Description | Status |",
        "|---|---|---|---|---|---|",
    ]
    for context in model.get("contexts", []):
        link = f"[{context['name']}](contexts/{context['id']}.md#{anchor})"
        for rule in context.get("rules", []):
            lines.append(
                f"| {link} |  | `{rule['id']}` | `{rule.get('kind', '')}` | "
                f"{rule['description']} | `{rule.get('status', '')}` |"
            )
        for aggregate in context.get("aggregates", []):
            for rule in aggregate.get("rules", []):
                lines.append(
                    f"| {link} | `{aggregate['name']}` | `{rule['id']}` | "
                    f"`{rule.get('kind', '')}` | {rule['description']} | `{rule.get('status', '')}` |"
                )
    return "\n".join(lines) + "\n"


# --------------------------------------------------------------- artifact ---
# Per-domain review surface. Structure follows two documented practices:
#   - ddd-crew Bounded Context Canvas: one canvas per context, business-first
#     (purpose, classification, ubiquitous language, business decisions, open questions).
#   - ddd-crew EventStorming grammar: actor -> command -> constraint -> event <- policy.
# Hence the nine facets below are domain concepts, not code-artifact kinds: a
# stakeholder discusses Aggregates, Rules, Events and Lifecycle, never Repository
# or Factory. Every facet maps to real fields in domain-model.schema.json; a facet
# with no data source would be decoration.

# --------------------------------------------------------------- artifact ---
# Per-domain review surface. Structure follows two documented practices:
#   - ddd-crew Bounded Context Canvas: one canvas per context, business-first
#     (purpose, classification, ubiquitous language, business decisions, open questions).
#   - ddd-crew EventStorming grammar: actor -> command -> constraint -> event <- policy.
# The nine facets are domain concepts, not code-artifact kinds: a stakeholder
# discusses Aggregates, Rules and Lifecycle, never Repository or Factory. Every
# facet reads real fields of domain-model.schema.json; a facet with no data
# source behind it would be decoration.
#
# There is deliberately NO audience switch. Every reader sees every facet; a long
# page stays usable through the sticky chip nav, and detail that only some readers
# need (ids, scopes, field lists) drops to small mono grey rather than being hidden.
# Hiding by role means the person who needs a fact cannot discover it exists.
#
# EventStorming's sticky colours ARE the colour system — orange event, blue
# command, yellow aggregate, lilac policy, green language, pink hotspot — so the
# page reads without a legend to anyone who has stood at that wall.

FACETS = [
    # key, section heading (DDD term, see references/glossary.md), why it matters, short label
    ("purpose", "Purpose & classification", "What this domain gives the business, and which subdomain it belongs to", "Purpose"),
    ("language", "Ubiquitous language", "The words this domain owns and defines", "Language"),
    ("aggregates", "Aggregates", "Data that must stay correct together, and what each aggregate holds", "Aggregates"),
    ("blocks", "Identity & building blocks", "How each aggregate is recognised, and its building blocks in DDD order", "Blocks"),
    ("lifecycle", "Lifecycle", "Each transition lists the guard that must hold before it can happen", "Lifecycle"),
    ("commands", "Commands & use cases", "Who may ask this domain to do what", "Commands"),
    ("events", "Events", "Things that happened and that other parts can react to", "Events"),
    ("rules", "Rules & policies", "Invariants, policies, authorization", "Rules"),
    ("integration", "Integration & hotspots", "Which contexts it works with, through what, and what is still unclear", "Integration"),
]

# DDD glossary shown on the page and written to glossary.md. Terms stay in DDD wording;
# each has a one-line meaning. Single source with references/glossary.md.
GLOSSARY = [
    ("Domain", "The business area the system serves"),
    ("Subdomain · core / supporting / generic", "A part of the domain, ranked by how much to invest: what makes us different / needed, but every competitor needs it / shared plumbing"),
    ("Bounded context", "The boundary of one model and its language. The same word may mean something else in the next context. Usually a service or package"),
    ("Ubiquitous language", "The vocabulary shared by the business and the code inside one context"),
    ("Aggregate / aggregate root", "Data that must stay correct together. Every change goes through one door, the aggregate root"),
    ("Entity", "A thing with its own identity that lives over time"),
    ("Value object", "A value with no identity, compared by content (Money, Weight)"),
    ("Domain primitive", "A single value type with constraints (Symbol, Price)"),
    ("Invariant", "What must never be false inside an aggregate"),
    ("Rule · policy / specification / authorization / uniqueness / workflow", "A named business rule: a decision that may change / a condition to check / who may do what / no duplicates / order of steps"),
    ("Lifecycle · state / transition / guard", "The states an aggregate moves through; the step between them; the condition that must hold before the step"),
    ("Command", "A request to do something (confirm, approve). It can be refused"),
    ("Event", "Something that already happened, in past tense (order.approved). Other parts can react to it"),
    ("Use case", "What a user does with the domain, usually several commands"),
    ("Building block", "A named DDD piece in the model: aggregate, entity, value object, service, port…"),
    ("Domain service", "A business operation that belongs to no single aggregate"),
    ("Repository / factory", "The door to read and write one aggregate / the place that creates an aggregate when creation has many rules"),
    ("Port / adapter", "The interface a context declares to call out or be called / the implementation for one concrete system (Shopee browser bridge, AccessTrade API)"),
    ("Anti-corruption layer (ACL)", "A layer that translates an outside language into our own"),
    ("Process manager", "A process that coordinates several aggregates over time (a job that expires a reservation)"),
    ("Read model", "Read-only data built from other sources for display and reports. It holds no rules"),
    ("Shared kernel", "A small part of the model two sides own together, such as the shared money package"),
    ("Context map pattern", "How two contexts relate: open-host service, published language, customer–supplier, conformist, partnership, ACL, separate ways"),
    ("EventStorming", "Reading a domain as a sentence: actor → command → aggregate → event ← policy. The colours on the page follow this convention"),
    ("Hotspot / open question (OQ)", "An unclear or disputed point, recorded as an open question with an owner who answers"),
    ("Decision (D)", "A decision agreed with the project owner. Cite the code D<n> with a short gist each time"),
    ("Status · observed / target / proposed / unknown", "exists in code / agreed goal, not yet coded / proposed, not yet agreed / unclear"),
]

# Ubiquitous language of the project: the business words every page uses. The single
# source is the "Business language" table in references/glossary.md, read at render time
# so a project edits one file only.
def _load_business_glossary() -> list[tuple[str, str]]:
    path = Path(__file__).resolve().parent.parent / "references" / "glossary.md"
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return []
    rows, inside = [], False
    for line in lines:
        if line.startswith("## "):
            inside = line.startswith("## Business language")
            continue
        if not inside or not line.startswith("|") or line.startswith("|---") or line.startswith("| Term |"):
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) >= 2:
            rows.append((cells[0].strip("*").strip(), cells[1]))
    return rows


BUSINESS_GLOSSARY = _load_business_glossary()

# Which EventStorming colour a building-block kind wears. Grouped so the 17 schema
# kinds collapse onto the six sticky colours the workshop already uses.
BLOCK_TONES = {
    "aggregate-root": "agg", "entity": "agg",
    "value-object": "lang", "domain-primitive": "lang", "shared-kernel": "lang",
    "domain-event": "event", "command": "cmd",
    "policy": "policy", "specification": "policy",
    "port": "cmd", "adapter": "cmd", "anti-corruption-layer": "cmd",
    "domain-service": "svc", "process-manager": "svc", "factory": "svc",
    "repository": "read", "read-model": "read",
}

# Kinds worth naming as a gap when a domain has none of them. Ordered as a reviewer
# would walk them; integration kinds are left out because not every domain needs one.
GAP_KINDS = ["entity", "value-object", "domain-service", "repository",
             "specification", "policy", "read-model"]

# Display order for the Blocks facet: identity first, then the way a DDD reviewer walks a context.
KIND_ORDER = [
    ("aggregate-root", "Aggregate root"), ("entity", "Entity"),
    ("value-object", "Value object"), ("domain-primitive", "Domain primitive"),
    ("domain-service", "Domain service"), ("factory", "Factory"), ("repository", "Repository"),
    ("specification", "Specification"), ("policy", "Policy"),
    ("command", "Command"), ("domain-event", "Domain event"),
    ("port", "Port"), ("adapter", "Adapter"), ("anti-corruption-layer", "Anti-corruption layer"),
    ("process-manager", "Process manager"), ("read-model", "Read model"), ("shared-kernel", "Shared kernel"),
]


# ------------------------------------------------------- per-context markdown ---
# Detail lives per context (`contexts/<id>.md`), one page per bounded context, walking
# the same nine FACETS in the same order as the HTML dossier — same data, same shape,
# so the two surfaces teach the same thing. These functions are a markdown-table
# restatement of the derivations in _ARTIFACT_SCRIPT's JS (termsOf, identityOf,
# commandsOf, eventsOf, flowsOf, rulesOf, ...): same schema fields, same gaps say-so,
# different renderer. FACETS and KIND_ORDER themselves are not restated — imported
# from the constants above, shared with the HTML/JS side via _artifact_parts().

def slugify_heading(text: str) -> str:
    """Anchor for a markdown heading, used so rule-catalog.md and README.md can link
    straight into a context page's facet section."""
    s = re.sub(r"[^\w\s-]", "", text.lower(), flags=re.UNICODE)
    return re.sub(r"\s+", "-", s.strip())


FACET_SLUGS = {key: slugify_heading(heading) for key, heading, _why, _label in FACETS}

# Labels keep the DDD keyword and add a short meaning only where the keyword alone
# would be opaque (status). Terms are never replaced by coinages.
VI_STATUS = {
    "observed": "observed · exists in code", "target": "target · agreed goal", "proposed": "proposed · not yet agreed",
    "unknown": "unknown · unclear", "accepted": "accepted · approved", "rejected": "rejected · turned down", "superseded": "superseded · replaced",
    "open": "open · awaiting answer", "resolved": "resolved · answered", "deferred": "deferred · for later",
}
VI_TYPE = {"core": "core", "supporting": "supporting", "generic": "generic", "unknown": "unknown"}
VI_RULE_KIND = {
    "invariant": "invariant", "policy": "policy", "specification": "specification",
    "authorization": "authorization", "uniqueness": "uniqueness", "workflow": "workflow",
    "rule": "rule", "unknown": "unknown",
}
VI_REL_KIND = {
    "PORT": "port", "EVENT": "event", "REFERENCE": "reference",
    "SHARED_KERNEL": "shared kernel", "EXTERNAL": "external",
}
VI_PATTERN = {
    "shared-kernel": "shared kernel", "open-host-service": "open-host service",
    "published-language": "published language", "customer-supplier": "customer–supplier",
    "anti-corruption-layer": "anti-corruption layer", "conformist": "conformist",
    "partnership": "partnership", "upstream-downstream": "upstream–downstream", "separate-ways": "separate ways",
}
VI_IMPORTANCE = {"high": "high", "medium": "medium", "low": "low"}

REF_RE = re.compile(r"(?<!`)\b(D|OQ)(\d{1,3})\b(?![-\w`])(?!\s[—(])")


def ref_index(model: dict[str, Any]) -> dict[str, str]:
    """'D15' / 'OQ8' -> short gist, from decisions[] / openQuestions[] ids like d15-… / oq8-…."""
    out: dict[str, str] = {}
    def gist(text: str) -> str:
        """First sentences up to ~120 chars — one short sentence alone ("The order is only a request.") says too little."""
        text = re.sub(r"\s+", " ", str(text or "")).strip()
        out = ""
        for piece in re.split(r"(?<=[.;])\s", text):
            if out and len(out) >= 60:
                break
            out = (out + " " + piece).strip()
        out = re.sub(r"\s*\[[^\]]*\]\s*$", "", out).rstrip(".; ")
        return out if len(out) <= 120 else out[:117].rstrip() + "…"
    for d in model.get("decisions", []) or []:
        m = re.match(r"d(\d+)-", str(d.get("id", "")))
        if m:
            g = gist(d.get("decision"))
            if d.get("status") == "superseded":
                by = re.match(r"d(\d+)-", str(d.get("supersededBy", "")))
                g = f"superseded by D{by.group(1)}: {g}" if by else f"superseded: {g}"
            out["D" + m.group(1)] = g
    for q in model.get("openQuestions", []) or []:
        m = re.match(r"oq(\d+)-", str(q.get("id", "")))
        if m:
            out["OQ" + m.group(1)] = gist(q.get("question"))
    return out


def expand_refs(text: str, refs: dict[str, str]) -> str:
    """'see D15' -> 'see D15 (gist of the decision…)'. Skips fenced code."""
    if not text or not refs:
        return text
    def sub(m: re.Match) -> str:
        key = m.group(0)
        if key not in refs:
            return key
        after = text_part[m.end():m.end() + 1]
        before = text_part[max(0, m.start() - 1):m.start()]
        # "(D50)" -> "(D50: gist)"; elsewhere "D50 (gist)". Never "(D50 (gist))".
        return f"{key}: {refs[key]}" if (before == "(" or after == ")") else f"{key} ({refs[key]})"
    parts = text.split("```")
    for i in range(0, len(parts), 2):
        text_part = parts[i]
        parts[i] = REF_RE.sub(sub, text_part)
    return "```".join(parts)
RULE_KIND_ORDER = ["invariant", "policy", "specification", "authorization", "uniqueness", "workflow", "rule", "unknown"]

ID_SUFFIX_RE = re.compile(r"(code|_id|id|uid|ref|number|no)$", re.IGNORECASE)
ID_NAME_RE = re.compile(r"(^|_)(code|uid|number|no)$", re.IGNORECASE)
NON_ENTITY_TYPE_RE = re.compile(r"^(json|string|datetime|date|boolean|integer|float|number|enum)$", re.IGNORECASE)


def vi(mapping: dict[str, str], key: str | None) -> str:
    return mapping.get(key, key) if key else ""


def md_empty(message: str) -> str:
    return f"_{message}_\n"


def _cell(value: Any) -> str:
    return str(value if value is not None else "").replace("|", "\\|").replace("\n", " ").strip()


def md_table(headers: list[str], rows: list[list[Any]]) -> str:
    if not rows:
        return ""
    out = ["| " + " | ".join(headers) + " |", "|" + "|".join(["---"] * len(headers)) + "|"]
    for row in rows:
        out.append("| " + " | ".join(_cell(c) for c in row) + " |")
    return "\n".join(out) + "\n"


def aggs_of(context: dict[str, Any] | None) -> list[dict[str, Any]]:
    return (context or {}).get("aggregates", []) or []


def own_blocks(model: dict[str, Any], cid: str) -> list[dict[str, Any]]:
    return [b for b in model.get("buildingBlocks", []) if b.get("context") == cid]


def shared_blocks(model: dict[str, Any]) -> list[dict[str, Any]]:
    return [b for b in model.get("buildingBlocks", []) if not b.get("context")]


def rels_of(model: dict[str, Any], cid: str) -> list[dict[str, Any]]:
    return [r for r in model.get("relations", []) if r.get("from") == cid or r.get("to") == cid]


def identity_of(aggregate: dict[str, Any], all_blocks: list[dict[str, Any]]) -> dict[str, Any] | None:
    fields = [f for f in aggregate.get("fields", []) or [] if f.get("identity") is not False]
    flagged = [f for f in fields if f.get("identity") is True]
    strong = [f for f in fields if f.get("kind") == "primitive" and f.get("required") and f.get("readOnly")]

    def named_match(f: dict[str, Any]) -> bool:
        if f.get("kind") != "primitive":
            return False
        return bool(ID_SUFFIX_RE.search(str(f.get("type", "")))) or bool(ID_NAME_RE.search(str(f.get("name", ""))))

    named = [f for f in fields if named_match(f)]
    pick = (flagged or strong or named or [None])[0]
    if not pick:
        return None
    prim = next(
        (b for b in all_blocks if b.get("kind") == "domain-primitive" and b.get("aggregate") == aggregate.get("id")
         and (b.get("name") == pick.get("type") or (pick.get("type") or "") in (b.get("name") or ""))),
        None,
    )
    rule = next(
        (i for i in aggregate.get("invariants", []) or []
         if str(pick.get("name", "")).lower() in i.lower() or str(pick.get("type", "")) in i),
        None,
    )
    note = (prim or {}).get("purpose") or pick.get("description") or rule or ""
    return {"field": pick.get("name"), "type": pick.get("type"), "note": note}


def terms_of(context: dict[str, Any], cid: str, own: list[dict[str, Any]]) -> list[dict[str, Any]]:
    kinds = {"value-object", "domain-primitive", "shared-kernel"}
    out = []
    seen = set()
    for b in own:
        if b.get("kind") in kinds:
            out.append({"name": b["name"], "note": b.get("purpose", ""), "src": b["kind"]})
            seen.add(b["name"])
    for a in aggs_of(context):
        for f in a.get("fields", []) or []:
            t = f.get("type")
            if f.get("kind") in ("value-object", "entity") and t and t not in seen and not NON_ENTITY_TYPE_RE.match(t):
                seen.add(t)
                note = f"Type of field {f['name']} on {a['name']}"
                if f.get("description"):
                    note += f": {f['description']}"
                out.append({"name": t, "note": note, "src": f["kind"]})
    return out


def lifecycles_of(context: dict[str, Any]) -> list[dict[str, Any]]:
    out = []
    for a in aggs_of(context):
        lc = a.get("lifecycle")
        if lc and lc.get("states"):
            out.append({"agg": a["name"], "lc": lc})
    return out


def commands_of(context: dict[str, Any], lifecycles: list[dict[str, Any]], own: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out = []
    for u in context.get("useCases", []) or []:
        name = u.get("name") if isinstance(u, dict) else u
        note = u.get("description") if isinstance(u, dict) else None
        actor = (u.get("actor") if isinstance(u, dict) else None) or "use case"
        out.append({"name": name, "note": note, "from": actor})
    seen = {o["name"] for o in out}
    for item in lifecycles:
        agg, lc = item["agg"], item["lc"]
        for t in lc.get("transitions", []) or []:
            key = f"{agg}.{t['action']}"
            if key in seen:
                continue
            seen.add(key)
            out.append({"name": t["action"], "note": t.get("description") or f"{t['from']} → {t['to']}", "from": agg})
    for b in own:
        if b.get("kind") == "command":
            out.append({"name": b["name"], "note": b.get("purpose"), "from": "command"})
    return out


def events_of(context: dict[str, Any], lifecycles: list[dict[str, Any]], own: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out = []
    seen = set()
    for e in context.get("events", []) or []:
        is_dict = isinstance(e, dict)
        name = (e.get("name") or e.get("id")) if is_dict else e
        eid = e.get("id") if is_dict else None
        out.append({
            "name": name, "id": eid, "note": e.get("description") if is_dict else None,
            "from": "declared", "consumers": (e.get("consumers") or []) if is_dict else [],
        })
        if name:
            seen.add(name)
        if eid:
            seen.add(eid)

    def push(name: str | None, note: str | None, frm: str) -> None:
        if name and name not in seen:
            seen.add(name)
            out.append({"name": name, "note": note, "from": frm, "consumers": []})

    for a in aggs_of(context):
        for e in a.get("events", []) or []:
            is_dict = isinstance(e, dict)
            push(e.get("name") if is_dict else e, e.get("description") if is_dict else None, a["name"])
    for item in lifecycles:
        agg, lc = item["agg"], item["lc"]
        for t in lc.get("transitions", []) or []:
            for e in t.get("emits", []) or []:
                push(e, t.get("description") or f"After command `{t['action']}` on {agg}", agg)
    for b in own:
        if b.get("kind") == "domain-event":
            push(b["name"], b.get("purpose"), "building block")
    return out


def flows_of(lifecycles: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out = []
    for item in lifecycles:
        agg, lc = item["agg"], item["lc"]
        for t in lc.get("transitions", []) or []:
            for e in t.get("emits", []) or []:
                out.append({"cmd": t["action"], "agg": agg, "event": e, "side": "; ".join(t.get("sideEffects", []) or [])})
    return out


def mutes_of(lifecycles: list[dict[str, Any]], flows: list[dict[str, Any]]) -> list[str]:
    emitting = {f["cmd"] for f in flows}
    seen = set()
    all_actions = []
    for item in lifecycles:
        for t in item["lc"].get("transitions", []) or []:
            if t["action"] not in seen:
                seen.add(t["action"])
                all_actions.append(t["action"])
    return [a for a in all_actions if a not in emitting]


def rules_of(context: dict[str, Any], own: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out = []
    for r in context.get("rules", []) or []:
        out.append({**r, "on": context["name"]})
    for a in aggs_of(context):
        for r in a.get("rules", []) or []:
            out.append({**r, "on": a["name"]})
        for inv in a.get("invariants", []) or []:
            out.append({"description": inv, "kind": "invariant", "on": a["name"]})
    for b in own:
        if b.get("kind") in ("policy", "specification"):
            out.append({"id": b.get("id"), "description": b.get("purpose"), "kind": b.get("kind"),
                        "on": b.get("aggregate") or context.get("name"), "status": b.get("status")})
    return out


def _touches(item: dict[str, Any], context: dict[str, Any]) -> bool:
    """A decision / question belongs on a context page when it names the context explicitly
    (`contexts: [...]`), cites one of its ids (`inventory.rule.x`, `product.item`), or says the
    context's display name. A bare substring test is wrong: "who" is inside "whole" and "who answers"."""
    cid = context["id"]
    if "contexts" in item:
        return cid in (item.get("contexts") or [])
    text = json.dumps({k: v for k, v in item.items() if k != "id"}, ensure_ascii=False)
    if re.search(rf"(?<![\w-]){re.escape(cid)}\.[a-z]", text):
        return True
    name = context.get("name") or ""
    return bool(name) and name.lower() in text.lower()


def questions_touching(model: dict[str, Any], context: dict[str, Any]) -> list[dict[str, Any]]:
    return [q for q in model.get("openQuestions", []) or [] if _touches(q, context)]


def decisions_touching(model: dict[str, Any], context: dict[str, Any]) -> list[dict[str, Any]]:
    return [d for d in model.get("decisions", []) or [] if _touches(d, context)]


def lifecycle_mermaid(lifecycle: dict[str, Any]) -> str:
    lines = ["stateDiagram-v2", "    direction LR", f"    [*] --> {safe_id(lifecycle['initial'])}"]
    transitions = lifecycle.get("transitions", []) or []
    for t in transitions:
        guard_str = ", ".join(re.sub(r'[<>"]', "", g.split(".")[-1]) for g in (t.get("guards") or []))
        action = re.sub(r'[<>"]', "", str(t["action"]))
        label = f"{action} [{guard_str}]" if guard_str else action
        lines.append(f"    {safe_id(t['from'])} --> {safe_id(t['to'])}: {label}")
    froms_with_outgoing = {t["from"] for t in transitions}
    for state in lifecycle.get("states", []) or []:
        name = state.get("name") if isinstance(state, dict) else state
        terminal = isinstance(state, dict) and state.get("terminal")
        if terminal or name not in froms_with_outgoing:
            lines.append(f"    {safe_id(name)} --> [*]")
    return "\n".join(lines)


def grouped_blocks_md(blocks: list[dict[str, Any]]) -> str:
    by_kind: dict[str, list[dict[str, Any]]] = {}
    for b in blocks:
        by_kind.setdefault(b.get("kind", "unknown"), []).append(b)
    known = {k for k, _ in KIND_ORDER}
    order = list(KIND_ORDER) + [(k, k) for k in by_kind if k not in known]
    parts = []
    for kind, label in order:
        group = by_kind.get(kind)
        if not group:
            continue
        parts.append(f"**{label}** ({len(group)})\n")
        rows = []
        for b in group:
            meta = ", ".join(filter(None, [b.get("scope", ""), f"in {b['aggregate']}" if b.get("aggregate") else "", b.get("location", "")]))
            detail = "; ".join([*(b.get("responsibilities") or []), *(b.get("invariants") or [])])
            rows.append([f"`{b['name']}`", b.get("purpose", ""), detail, meta])
        parts.append(md_table(["Building block", "Purpose", "Detail", "Scope"], rows))
        parts.append("")
    return "\n".join(parts)


def f_purpose(model: dict[str, Any], context: dict[str, Any]) -> str:
    lines = []
    if context.get("businessCapability"):
        lines.append(f"> {context['businessCapability']}")
        lines.append("")
    meta = []
    if context.get("domainType"):
        meta.append(f"**Subdomain type:** {vi(VI_TYPE, context['domainType'])}")
    if context.get("status"):
        meta.append(f"**Status:** {vi(VI_STATUS, context['status'])}")
    if context.get("strategicImportance"):
        meta.append(f"**Strategic importance:** {vi(VI_IMPORTANCE, context['strategicImportance'])}")
    if context.get("owner"):
        meta.append(f"**Owner:** {context['owner']}")
    if meta:
        lines.append(" · ".join(meta))
        lines.append("")
    patterns = context.get("contextMapPatterns") or []
    if patterns:
        lines.append("**Context map patterns:** " + ", ".join(vi(VI_PATTERN, p) for p in patterns))
        lines.append("")
    if context.get("description"):
        lines.append(context["description"])
        lines.append("")
    strategic = model.get("strategicModel") or {}
    sub = next((s for s in strategic.get("subdomains", []) or [] if context["id"] in (s.get("contextIds") or [])), None)
    if sub:
        lines.append(f"**Subdomain:** {sub['name']} ({vi(VI_TYPE, sub.get('domainType'))})")
        if sub.get("description"):
            lines.append("")
            lines.append(sub["description"])
        lines.append("")
    return "\n".join(lines).strip()


def f_language(context: dict[str, Any], cid: str, own: list[dict[str, Any]]) -> str:
    terms = terms_of(context, cid, own)
    if not terms:
        return md_empty("No words declared for this domain. A word can mean something else in the next domain without anyone noticing.")
    rows = [[f"`{t['name']}`", t["src"], t.get("note") or ""] for t in terms]
    return md_table(["Term", "Source", "Note"], rows)


def f_aggregates(context: dict[str, Any], all_blocks: list[dict[str, Any]]) -> str:
    aggs = aggs_of(context)
    if not aggs:
        return md_empty("No aggregate owns its own rules in this domain.")
    parts = []
    for a in aggs:
        idn = identity_of(a, all_blocks)
        head = f"### {a['name']}"
        if a.get("resource"):
            head += f" · `{a['resource']}`"
        parts.append(head)
        if a.get("status"):
            parts.append(f"_{vi(VI_STATUS, a['status'])}_")
        if a.get("description"):
            parts.append(a["description"])
        if idn:
            note = f". {idn['note']}" if idn.get("note") else ""
            parts.append(f"**Identity:** `{idn['field']} : {idn['type']}`{note}")
        else:
            parts.append("**Identity:** _no identity yet_. No field names a single record.")
        if a.get("consistencyBoundary"):
            parts.append(f"> {a['consistencyBoundary']}")
        invariants = a.get("invariants") or []
        if invariants:
            parts.append("**Invariants:**")
            parts.extend(f"- {i}" for i in invariants)
        fields = a.get("fields") or []
        if fields:
            rows = []
            for f in fields:
                type_or_ref = f"→ `{f['references']}`" if f.get("references") else f"`{f.get('type', '')}`"
                rows.append([f"`{f['name']}`", type_or_ref, "yes" if f.get("required") else "", f.get("description", "")])
            parts.append(f"**{len(fields)} fields:**")
            parts.append(md_table(["Field", "Type / reference", "Required", "Description"], rows))
        parts.append("")
    return "\n".join(parts)


def f_blocks(context: dict[str, Any], own: list[dict[str, Any]], shared: list[dict[str, Any]], all_blocks: list[dict[str, Any]]) -> str:
    parts = []
    aggs = aggs_of(context)
    if aggs:
        rows = []
        for a in aggs:
            idn = identity_of(a, all_blocks)
            if idn:
                rows.append([a["name"], f"`{idn['field']}`", f"`{idn['type']}`", idn.get("note", "")])
            else:
                rows.append([a["name"], "_no identity yet_", "", ""])
        parts.append("**Identity**: what names exactly one record. It separates an entity from a value object.\n")
        parts.append(md_table(["Aggregate", "Field", "Type", "Rule"], rows))
    if own:
        parts.append(grouped_blocks_md(own))
    else:
        parts.append(md_empty("This domain names no building blocks of its own. A code review has nothing to point at."))
    if shared:
        parts.append(f"**Borrowed from shared kernel** ({len(shared)})\n")
        parts.append(grouped_blocks_md(shared))
    if own:
        have = {b.get("kind") for b in own}
        missing = [k for k in GAP_KINDS if k not in have]
        if missing:
            parts.append(
                "**Not modelled yet:** " + ", ".join(f"`{k}`" for k in missing)
                + ". This is not always a gap: a supporting domain often keeps its rules inside the aggregate root."
            )
    return "\n".join(p for p in parts if p)


def f_lifecycle(context: dict[str, Any], lifecycles: list[dict[str, Any]]) -> str:
    if not lifecycles:
        return md_empty("Nothing here changes state in a way that changes what is allowed.")
    parts = []
    for item in lifecycles:
        agg, lc = item["agg"], item["lc"]
        head = f"### {agg}"
        if lc.get("stateType"):
            head += f" · `{lc['stateType']}`"
        parts.append(head)
        if lc.get("description"):
            parts.append(lc["description"])
        parts.append("```mermaid")
        parts.append(lifecycle_mermaid(lc))
        parts.append("```")
        transitions = lc.get("transitions", []) or []
        rows = []
        for t in transitions:
            guards = ", ".join(g.split(".")[-1] for g in (t.get("guards") or [])) or "—"
            emits = ", ".join(t.get("emits") or []) or "—"
            then = " · ".join(filter(None, [*(t.get("sideEffects") or []), t.get("description") or ""]))
            flags = []
            if t.get("reversible") is False:
                flags.append("one-way")
            if t.get("compensating"):
                flags.append("compensating")
            if flags:
                then = ((then + " ") if then else "") + " ".join(f"[{f}]" for f in flags)
            rows.append([t["from"], t["action"], t["to"], guards, emits, then or "—"])
        parts.append(f"**{len(transitions)} transitions**: guard, event emitted, what happens next\n")
        parts.append(md_table(["From", "Command", "To", "Guard", "Emits", "Then"], rows))
        parts.append("")
    return "\n".join(parts)


def f_commands(context: dict[str, Any], lifecycles: list[dict[str, Any]], own: list[dict[str, Any]]) -> str:
    cmds = commands_of(context, lifecycles, own)
    if not cmds:
        return md_empty("No command or use case recorded that asks this domain to do something.")
    rows = [[c["name"], c["from"], c.get("note") or ""] for c in cmds]
    return md_table(["Command / use case", "From", "Note"], rows)


def f_events(context: dict[str, Any], lifecycles: list[dict[str, Any]], own: list[dict[str, Any]]) -> str:
    flows = flows_of(lifecycles)
    es = events_of(context, lifecycles, own)
    if not flows and not es:
        return md_empty("This domain emits no events. Nothing elsewhere can react to what happens here.")
    parts = []
    if flows:
        sentences = []
        for f in flows:
            s = f"command `{f['cmd']}` → aggregate `{f['agg']}` → event **{f['event']}**"
            if f.get("side"):
                s += f"; then {f['side']}"
            sentences.append(f"- {s}")
        parts.append("\n".join(sentences))
        mutes = mutes_of(lifecycles, flows)
        if mutes:
            parts.append("")
            parts.append("Commands that emit no event (nothing elsewhere can react): " + ", ".join(f"`{m}`" for m in mutes))
    event_names_in_flows = {f["event"] for f in flows}
    extra = [e for e in es if e["name"] not in event_names_in_flows]
    if extra:
        rows = [[e.get("id") or e["name"], e.get("note") or "", ", ".join(e.get("consumers") or []) or e.get("from", "")] for e in extra]
        parts.append("")
        parts.append(md_table(["Event", "Happens when", "Who listens"], rows))
    return "\n".join(parts)


def f_rules(context: dict[str, Any], own: list[dict[str, Any]]) -> str:
    rs = rules_of(context, own)
    if not rs:
        return md_empty("No invariant or policy recorded for this domain.")
    by_kind: dict[str, list[dict[str, Any]]] = {}
    for r in rs:
        by_kind.setdefault(r.get("kind") or "rule", []).append(r)
    parts = []
    for kind in sorted(by_kind, key=lambda k: RULE_KIND_ORDER.index(k) if k in RULE_KIND_ORDER else len(RULE_KIND_ORDER)):
        group = by_kind[kind]
        parts.append(f"**{vi(VI_RULE_KIND, kind)}** ({len(group)})\n")
        rows = [[r.get("description", ""), r.get("on", ""), vi(VI_STATUS, r.get("status")) if r.get("status") else ""] for r in group]
        parts.append(md_table(["Rule", "Declared on", "Status"], rows))
        parts.append("")
    return "\n".join(parts)


def f_integration(model: dict[str, Any], context: dict[str, Any], cid: str, by_id: dict[str, dict[str, Any]]) -> str:
    parts = []
    rels = rels_of(model, cid)
    if rels:
        rows = []
        for r in rels:
            outbound = r["from"] == cid
            if outbound:
                direction = "notifies" if r["kind"] == "EVENT" else "calls"
                other = r["to"]
            else:
                direction = "listens to" if r["kind"] == "EVENT" else "used by"
                other = r["from"]
            other_name = (by_id.get(other) or {}).get("name", other)
            rows.append([
                direction, other_name, vi(VI_REL_KIND, r["kind"]), r.get("via") or r.get("description", ""),
                vi(VI_PATTERN, r.get("pattern")) if r.get("pattern") else "",
                vi(VI_STATUS, r.get("status")) if r.get("status") else "",
            ])
        parts.append(md_table(["Direction", "Context", "Kind", "Via", "Pattern", "Status"], rows))
    else:
        parts.append(md_empty("No relations declared. Either this domain stands alone, or the map is incomplete."))
    qs = questions_touching(model, context)
    if qs:
        parts.append(f"\n**Open questions** ({len(qs)})\n")
        for q in qs:
            line = f"- {q['question']}"
            extra = []
            if q.get("impact"):
                extra.append(q["impact"])
            if q.get("owner"):
                extra.append(f"who answers: {q['owner']}")
            if q.get("status") and q["status"] != "open":
                extra.append(vi(VI_STATUS, q["status"]))
            if extra:
                line += " _(" + "; ".join(extra) + ")_"
            parts.append(line)
    ds = decisions_touching(model, context)
    if ds:
        parts.append(f"\n**Related decisions** ({len(ds)})\n")
        rows = [[d.get("decision", ""), d.get("rationale", ""), vi(VI_STATUS, d.get("status") or "proposed")] for d in ds]
        parts.append(md_table(["Decision", "Why", "Status"], rows))
    return "\n".join(parts)


def render_context_page(model: dict[str, Any], context: dict[str, Any], by_id: dict[str, dict[str, Any]], all_blocks: list[dict[str, Any]]) -> str:
    """One page per bounded context — the nine FACETS, in FACETS order, same headings
    as the HTML dossier. A facet with nothing says so; it is never silently omitted."""
    cid = context["id"]
    own = own_blocks(model, cid)
    shared = shared_blocks(model)
    lifecycles = lifecycles_of(context)
    facet_bodies = {
        "purpose": f_purpose(model, context),
        "language": f_language(context, cid, own),
        "aggregates": f_aggregates(context, all_blocks),
        "blocks": f_blocks(context, own, shared, all_blocks),
        "lifecycle": f_lifecycle(context, lifecycles),
        "commands": f_commands(context, lifecycles, own),
        "events": f_events(context, lifecycles, own),
        "rules": f_rules(context, own),
        "integration": f_integration(model, context, cid, by_id),
    }
    lines = [f"# {context['name']}", ""]
    sub = f"`{cid}`"
    if context.get("label"):
        sub += f" · `{context['label']}`"
    lines.extend([sub, ""])
    for key, heading, _why, _label in FACETS:
        lines.append(f"## {heading}")
        lines.append("")
        body = (facet_bodies[key] or "").strip()
        lines.append(body if body else md_empty("Nothing recorded here.").strip())
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def render_context_pages(model: dict[str, Any]) -> dict[str, str]:
    by_id = {c["id"]: c for c in model.get("contexts", [])}
    all_blocks = model.get("buildingBlocks", [])
    return {f"{cid}.md": render_context_page(model, context, by_id, all_blocks) for cid, context in by_id.items()}


def render_domain_viz_readme(model: dict[str, Any]) -> str:
    lines = [
        f"# {model.get('application', 'Domain')}: domain-viz index",
        "",
        "Generated by `scripts/render_domain_model.py` from `docs/domain-model.json`. Detail",
        "lives on each context's page under `contexts/`; the files below are either the two",
        "full-page HTML views, or a genuinely cross-context question no single context page",
        "can answer.",
        "",
        "## Files",
        "",
        "| File | Answers |",
        "|---|---|",
        "| `domain-explorer.html` | The full review page, standalone; opens straight off disk. |",
        "| `claude-artifact.html` | Same page, as an Artifact-ready fragment for publishing. |",
        "| `context-map.md` | Which contexts call or publish to which, via what. |",
        "| `strategic-map.md` | Primary domain and core/supporting/generic subdomain classification. |",
        "| `aggregate-map.md` | Cross-context aggregate overview and the relations between them, names only; per-aggregate detail is on the context page. |",
        "| `event-flow.md` | Cross-context event flow: who produces, who consumes. |",
        "| `rule-catalog.md` | Every rule in the model, one row each, linking back to its context. |",
        "| `qa.md` | Q&A: every open question grouped by who must answer, and the decision log newest first (same as the Q&A view on the page). |",
        "| `glossary.md` | Business vocabulary (one line per word) and the DDD terms used across these pages (kept in English); how D<n>/OQ<n> references are written. |",
        "| `contexts/<id>.md` | One page per context: purpose & classification, ubiquitous language, aggregates, identity & building blocks, lifecycle, commands & use cases, events, rules & policies, integration & hotspots. |",
        "",
        "## Contexts",
        "",
        "| Context | Type | Aggregates | Page |",
        "|---|---|---|---|",
    ]
    for c in model.get("contexts", []):
        agg_n = len(c.get("aggregates", []) or [])
        lines.append(f"| {c['name']} | `{c.get('domainType', 'unknown')}` | {agg_n} | [contexts/{c['id']}.md](contexts/{c['id']}.md) |")
    lines.append("")
    return "\n".join(lines)


def _artifact_parts(model: dict[str, Any]) -> tuple[str, str, str]:
    """(title, <style>+<body content>, <script>) — shared by both HTML outputs."""
    payload = json.dumps(model, ensure_ascii=False, separators=(",", ":")).replace("<", "\\u003c")
    app = model.get("application", "Domain model")
    title = html.escape(f"Domain map {app}")
    script = (
        _ARTIFACT_SCRIPT
        .replace("__PAYLOAD__", payload)
        .replace("__FACETS__", json.dumps(FACETS, ensure_ascii=False))
        .replace("__TONES__", json.dumps(BLOCK_TONES, ensure_ascii=False))
        .replace("__GAPKINDS__", json.dumps(GAP_KINDS, ensure_ascii=False))
        .replace("__KINDORDER__", json.dumps(KIND_ORDER, ensure_ascii=False))
        .replace("__GLOSSARY__", json.dumps(GLOSSARY, ensure_ascii=False))
        .replace("__BUSINESS_GLOSSARY__", json.dumps(BUSINESS_GLOSSARY, ensure_ascii=False))
    )
    return title, _ARTIFACT_STYLE + _ARTIFACT_MARKUP, script


def render_claude_artifact(model: dict[str, Any]) -> str:
    """Artifact-ready fragment: title + style + content, no document wrapper.

    The Claude Artifact host supplies <!doctype>/<head>/<body>, so emitting our own
    would nest a second document inside the page.
    """
    title, body, script = _artifact_parts(model)
    return f"<title>{title}</title>\n{body}\n{script}\n"


def render_html(model: dict[str, Any]) -> str:
    """Standalone document for opening the file straight off disk."""
    title, body, script = _artifact_parts(model)
    return (
        "<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n"
        "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1, viewport-fit=cover\">\n"
        f"<title>{title}</title>\n"
        "<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}"
        "body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>\n"
        f"{body}\n</head>\n<body>\n{script}\n</body>\n</html>\n"
    )


_ARTIFACT_STYLE = """<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap">
<style>
  :root {
    color-scheme: light;
    /* Neutrals, type, radii, shadows, motion: Stripe's real tokens (OpenDesign, opendesign.cc/packs/stripe). */
    --paper: #F8FAFD; --surface: #FFFFFF; --sunk: #E5EDF5; --line: #E5EDF5; --line-soft: rgba(229,237,245,.6);
    --ink: #061B31; --ink-2: #50617A; --muted: #64748D; --accent: #533AFD; --rule: rgba(6,27,49,.18);
    --shadow-rest: 0 3px 6px rgba(23,23,23,.06); --shadow-lift: 0 15px 35px rgba(23,23,23,.08);
    --ease: cubic-bezier(.25,1,.5,1);
    /* EventStorming sticky grammar — information, not decoration. */
    --event: #8C430A; --event-soft: #FDF1E4; --event-edge: #F0CFA8;
    --cmd: #16458C;   --cmd-soft: #E8F0FC;   --cmd-edge: #B8D0F0;
    --agg: #6F5309;   --agg-soft: #FBF3DC;   --agg-edge: #EBD9A6;
    --policy: #543596;--policy-soft: #F3EFFC;--policy-edge: #D8CBF2;
    --lang: #0C5E46;  --lang-soft: #E1F3EC;  --lang-edge: #A9DCC9;
    --hot: #B32C63;   --hot-soft: #FBE6EE;   --hot-edge: #F2C9D9;
    --svc: #1F5FBF; --read: #4A5A6B;
    --core: #11795A; --supporting: #9A7310; --generic: #5A6472;
    --sans: "Instrument Sans", ui-sans-serif, system-ui, -apple-system, sans-serif;
    --mono: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
    --rail-w: 264px; --top-h: 56px;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--paper); color: var(--ink); font-family: var(--sans); font-size: 16px; line-height: 1.5; }
  button, select { font: inherit; color: inherit; } button { cursor: pointer; }
  a { color: var(--accent); }
  a, button { transition: color .22s var(--ease), background-color .22s var(--ease), border-color .22s var(--ease), box-shadow .22s var(--ease), opacity .22s var(--ease); }
  h1, h2, h3, h4 { margin: 0; text-wrap: balance; font-weight: 500; letter-spacing: -.01em; }
  p { margin: 0; } ul { margin: 0; padding-left: 18px; }
  code { font-family: var(--mono); font-size: .86em; }
  .mono { font-family: var(--mono); font-size: 12px; color: var(--muted); }
  :where(a, button, summary):focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  @media (prefers-reduced-motion: reduce) { * { transition: none !important; } }

  /* ---------- frame ---------- */
  .topbar { position: sticky; top: env(safe-area-inset-top, 0px); z-index: 8; height: var(--top-h); background: var(--surface); border-bottom: 1px solid var(--line); display: flex; align-items: center; gap: 14px; padding: 0 24px; }
  .brand { display: flex; align-items: center; gap: 10px; text-decoration: none; color: var(--ink); font-weight: 600; font-size: 15px; letter-spacing: -.01em; }
  .mark { width: 26px; height: 26px; border-radius: 6px; background: var(--ink); color: #fff; display: grid; place-items: center; font-weight: 600; font-size: 13px; }
  .crumbs { display: flex; align-items: center; gap: 8px; color: var(--muted); font-size: 14px; min-width: 0; }
  .crumbs a { color: var(--muted); text-decoration: none; } .crumbs a:hover { color: var(--ink); }
  .crumbs .cur { color: var(--ink); font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .crumbs .sep { color: var(--rule); }
  .topmeta { margin-left: auto; display: flex; gap: 6px; align-items: center; }
  .chip { display: inline-flex; align-items: center; gap: 6px; height: 26px; line-height: 1; padding: 0 10px; border-radius: 999px; border: 1px solid var(--line); background: var(--surface); font-size: 12.5px; font-weight: 500; color: var(--ink-2); white-space: nowrap; }
  .chip.core { color: var(--core); border-color: var(--lang-edge); background: var(--lang-soft); }
  .chip.supporting { color: var(--supporting); border-color: var(--agg-edge); background: var(--agg-soft); }
  .chip.generic, .chip.unknown { color: var(--generic); background: var(--sunk); border-color: transparent; }
  .chip.hot { color: var(--hot); background: var(--hot-soft); border-color: var(--hot-edge); }
  .chip.quiet { color: var(--muted); border-color: transparent; background: transparent; padding: 0; height: auto; font-weight: 400; }
  .chip.up { text-transform: uppercase; letter-spacing: .07em; font-size: 11px; font-weight: 600; }
  .chip .dot { width: 7px; height: 7px; border-radius: 50%; }

  .layout { display: grid; grid-template-columns: var(--rail-w) minmax(0, 1fr); align-items: start; }
  .rail { position: sticky; top: calc(env(safe-area-inset-top, 0px) + var(--top-h)); height: calc(100vh - var(--top-h)); overflow-y: auto; background: var(--surface); border-right: 1px solid var(--line); padding: 14px 12px 32px; }
  .rail-head { font-size: 11px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); padding: 16px 12px 6px; }
  .rail-group { display: flex; flex-direction: column; gap: 1px; }
  .rail-group:first-child .rail-head { padding-top: 0; }
  .rail-item { display: flex; align-items: center; gap: 10px; width: 100%; min-height: 36px; text-align: left; border: 0; background: transparent; border-radius: 6px; padding: 7px 12px; color: var(--ink-2); font-size: 14px; line-height: 1.3; }
  .rail-item:hover { background: var(--paper); color: var(--ink); }
  .rail-item[aria-current="true"] { background: var(--sunk); color: var(--ink); font-weight: 500; }
  .rail-name { flex: 1 1 auto; min-width: 0; }
  .dot { width: 7px; height: 7px; border-radius: 50%; flex: none; background: var(--generic); }
  .dot.core { background: var(--core); } .dot.supporting { background: var(--supporting); }
  .ring { flex: none; width: 16px; height: 16px; }
  .ring circle { fill: none; stroke-width: 3; }
  .ring .bg { stroke: var(--sunk); } .ring .fg { stroke: var(--ink-2); stroke-linecap: butt; transform: rotate(-90deg); transform-origin: 50% 50%; }

  .main { padding: 32px 40px 96px; min-width: 0; }
  .wrap { display: flex; flex-direction: column; gap: 40px; }

  /* ---------- section rhythm ---------- */
  .sec { display: flex; flex-direction: column; gap: 14px; scroll-margin-top: calc(var(--top-h) + 64px); }
  .sec-head { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
  .sec-head h2 { font-size: 20px; }
  .sec-head .why { font-size: 14px; color: var(--muted); }
  .sec-head .n { font-family: var(--mono); font-size: 12px; color: var(--muted); }
  .panel { background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 22px 24px; }
  .grid2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(360px, 100%), 1fr)); gap: 14px; }
  .lbl { font-size: 11px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }
  .empty { border: 1px dashed var(--rule); border-radius: 8px; padding: 18px 20px; color: var(--muted); font-size: 14.5px; background: var(--surface); }
  .empty b { color: var(--ink-2); font-weight: 500; }
  .tablewrap { overflow-x: auto; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); }
  table { border-collapse: collapse; width: 100%; font-size: 14px; }
  th { text-align: left; font-size: 11px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); padding: 10px 14px; border-bottom: 1px solid var(--line); white-space: nowrap; background: var(--paper); }
  td { padding: 10px 14px; border-bottom: 1px solid var(--line-soft); color: var(--ink-2); vertical-align: top; }
  tr:last-child td { border-bottom: 0; } td.k { font-family: var(--mono); font-size: 12.5px; color: var(--ink); white-space: nowrap; }
  details.fold > summary { cursor: pointer; list-style: none; display: inline-flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 500; color: var(--ink-2); padding: 6px 0; }
  details.fold > summary::-webkit-details-marker { display: none; }
  details.fold > summary::before { content: "▸"; color: var(--muted); font-size: 11px; } details.fold[open] > summary::before { content: "▾"; }
  details.fold > summary:hover { color: var(--ink); }

  /* ---------- landscape ---------- */
  .hero { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 14px 24px; }
  .hero h1 { font-size: clamp(28px, 3.2vw, 36px); line-height: 1.05; letter-spacing: -.02em; }
  .hero .sub { color: var(--ink-2); font-size: 16px; margin-top: 6px; max-width: 70ch; }
  .hero .meta { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
  .stats { display: flex; gap: 28px; flex-wrap: wrap; }
  .stat { display: flex; flex-direction: column; gap: 2px; }
  .stat b { font-size: 22px; font-weight: 500; font-variant-numeric: tabular-nums; letter-spacing: -.01em; }
  .stat span { font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: .06em; font-weight: 600; }

  .smap { position: relative; background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 8px 0; }
  .smap svg.edges { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; overflow: visible; }
  .edges path { fill: none; stroke-width: 1.4; opacity: .32; transition: opacity .22s var(--ease), stroke-width .22s var(--ease); }
  .edges .e-port { stroke: var(--svc); } .edges .e-event { stroke: #C25E0A; stroke-dasharray: 5 3; } .edges .e-reference { stroke: var(--rule); } .edges .e-external { stroke: var(--generic); stroke-dasharray: 2 3; }
  .edges .target { opacity: .45; }
  .smap.focus .edges path { opacity: .06; } .smap.focus .edges path.on { opacity: 1; stroke-width: 2; }
  .band { position: relative; display: grid; grid-template-columns: 136px minmax(0, 1fr); align-items: start; padding: 18px 24px 18px 0; border-top: 1px solid var(--line-soft); }
  .band:first-of-type { border-top: 0; }
  .band-label { display: flex; flex-direction: column; gap: 4px; padding-left: 24px; }
  .band-label b { font-size: 12px; letter-spacing: .08em; text-transform: uppercase; font-weight: 600; }
  .band-label span { font-size: 12px; color: var(--muted); line-height: 1.35; }
  .band.core .band-label b { color: var(--core); } .band.supporting .band-label b { color: var(--supporting); } .band.generic .band-label b { color: var(--generic); }
  .tiles { display: flex; flex-wrap: wrap; gap: 12px; position: relative; z-index: 1; }
  .tile { position: relative; width: 196px; text-align: left; background: var(--surface); border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px 12px; display: flex; flex-direction: column; gap: 8px; box-shadow: var(--shadow-rest); }
  .tile:hover { box-shadow: var(--shadow-lift); border-color: var(--rule); }
  .tile.target { border-style: dashed; box-shadow: none; }
  .tile::before { content: ""; position: absolute; left: 14px; right: 14px; top: 0; height: 2px; border-radius: 0 0 2px 2px; background: var(--generic); }
  .tile.core::before { background: var(--core); } .tile.supporting::before { background: var(--supporting); }
  .tile h3 { font-size: 14.5px; line-height: 1.25; }
  .tile .addon { font-family: var(--mono); font-size: 11px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tile .foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 12px; color: var(--muted); }
  .smap.focus .tile { opacity: .45; } .smap.focus .tile.on { opacity: 1; }
  .legend { display: flex; flex-wrap: wrap; gap: 6px 18px; font-size: 12.5px; color: var(--muted); padding: 2px 4px; }
  .legend i { display: inline-block; width: 22px; height: 0; border-top: 2px solid var(--svc); vertical-align: middle; margin-right: 6px; }
  .legend i.ev { border-top-style: dashed; border-color: #C25E0A; } .legend i.ref { border-color: var(--rule); } .legend i.tg { border-color: var(--rule); border-top-style: dashed; }

  .hot { background: var(--surface); border: 1px solid var(--line); border-left: 3px solid var(--hot); border-radius: 8px; padding: 14px 16px; display: flex; flex-direction: column; gap: 5px; }
  .hot p { font-size: 15px; line-height: 1.45; color: var(--ink); }
  .hot .sub { font-size: 13px; color: var(--ink-2); }
  .hot .sub b { color: var(--hot); font-weight: 600; }

  /* ---------- dossier header ---------- */
  .dhead { display: flex; flex-direction: column; gap: 14px; }
  .dhead .row { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
  .dhead h1 { font-size: clamp(28px, 3.2vw, 38px); line-height: 1.05; letter-spacing: -.02em; }
  .dhead .cap { font-size: 17px; color: var(--ink-2); max-width: 78ch; }
  .cover { display: grid; grid-template-columns: repeat(9, minmax(0, 1fr)); gap: 4px; }
  .cover a { display: flex; flex-direction: column; gap: 6px; text-decoration: none; color: var(--ink-2); font-size: 11.5px; font-weight: 500; letter-spacing: .02em; }
  .cover a i { display: block; height: 4px; border-radius: 2px; background: var(--ink-2); }
  .cover a.gap { color: var(--muted); } .cover a.gap i { background: var(--sunk); }
  .cover a:hover { color: var(--ink); }
  .cover a span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .chipnav { position: sticky; top: calc(env(safe-area-inset-top, 0px) + var(--top-h)); z-index: 6; background: rgba(248,250,253,.96); backdrop-filter: blur(8px); margin: 0 -40px; padding: 10px 40px; border-bottom: 1px solid var(--line); display: flex; gap: 4px; overflow-x: auto; scrollbar-width: none; }
  .chipnav::-webkit-scrollbar { display: none; }
  .chipnav a { flex: none; text-decoration: none; color: var(--ink-2); font-size: 13.5px; font-weight: 500; padding: 6px 12px; border-radius: 6px; }
  .chipnav a:hover { background: var(--sunk); color: var(--ink); }
  .chipnav a .n { font-family: var(--mono); font-size: 11px; color: var(--muted); margin-left: 5px; }

  /* ---------- canvas ---------- */
  .canvas { display: grid; grid-template-columns: minmax(220px, 1fr) minmax(300px, 1.6fr) minmax(220px, 1fr); gap: 14px; align-items: stretch; }
  .cv { background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 18px 20px; display: flex; flex-direction: column; gap: 14px; }
  .cv.in { border-top: 3px solid var(--cmd); } .cv.out { border-top: 3px solid #C25E0A; } .cv.mid { border-top: 3px solid var(--ink); }
  .cv h3 { font-size: 13px; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); font-weight: 600; display: flex; justify-content: space-between; align-items: baseline; }
  .cv h3 small { font-family: var(--mono); font-size: 11px; letter-spacing: 0; text-transform: none; }
  .msg { display: flex; flex-direction: column; gap: 3px; padding: 10px 12px; border-radius: 8px; border: 1px solid var(--line); background: var(--paper); }
  .msg.cmd { background: var(--cmd-soft); border-color: var(--cmd-edge); } .msg.ev { background: var(--event-soft); border-color: var(--event-edge); }
  .msg b { font-family: var(--mono); font-size: 12.5px; font-weight: 500; color: var(--ink); word-break: break-word; }
  .msg span { font-size: 12.5px; color: var(--ink-2); }
  .msg .who { font-size: 12px; color: var(--muted); }
  .kv { display: flex; flex-direction: column; gap: 4px; }
  .kv .lbl { margin-bottom: 2px; } .kv p { font-size: 15px; line-height: 1.5; color: var(--ink); }
  .terms { display: flex; flex-wrap: wrap; gap: 6px; }
  .term { font-family: var(--mono); font-size: 12px; padding: 4px 8px; border-radius: 4px; background: var(--lang-soft); color: var(--lang); border: 1px solid var(--lang-edge); }
  .rulelist { display: flex; flex-direction: column; gap: 8px; }
  .rule { display: grid; grid-template-columns: 92px 1fr; gap: 10px; font-size: 14px; line-height: 1.45; color: var(--ink); padding: 8px 0; border-top: 1px solid var(--line-soft); }
  .rule:first-child { border-top: 0; padding-top: 0; }
  .rule .kind { font-size: 11px; letter-spacing: .06em; text-transform: uppercase; color: var(--policy); font-weight: 600; padding-top: 3px; }

  /* ---------- aggregates ---------- */
  .aggs { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(380px, 100%), 1fr)); gap: 14px; }
  .agg { background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 20px 22px; display: flex; flex-direction: column; gap: 12px; }
  .agg .top { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .agg h3 { font-size: 19px; flex-grow: 1; }
  .agg .res { font-family: var(--mono); font-size: 12px; color: var(--muted); }
  .agg p.desc { font-size: 14.5px; color: var(--ink-2); line-height: 1.5; }
  .key { display: grid; grid-template-columns: auto 1fr; gap: 10px; align-items: start; background: var(--paper); border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; }
  .key .tag { font-size: 10.5px; letter-spacing: .08em; text-transform: uppercase; font-weight: 600; color: var(--ink-2); padding-top: 3px; }
  .key b { font-family: var(--mono); font-size: 13px; font-weight: 500; color: var(--ink); }
  .key span { display: block; font-size: 13px; color: var(--ink-2); margin-top: 2px; }
  .key.none { border-style: dashed; border-color: var(--hot-edge); background: var(--hot-soft); } .key.none b { color: var(--hot); }
  .bound { font-size: 14.5px; line-height: 1.5; color: var(--ink); padding-left: 12px; border-left: 2px solid var(--ink); }
  .inv { font-size: 14px; color: var(--ink-2); display: flex; flex-direction: column; gap: 4px; }
  .inv li { padding-left: 2px; }
  .fields { display: flex; flex-wrap: wrap; gap: 5px; }
  .fld { font-family: var(--mono); font-size: 11.5px; padding: 3px 7px; border-radius: 4px; border: 1px solid var(--line); background: var(--paper); color: var(--ink-2); }
  .fld.ref { border-color: var(--cmd-edge); color: var(--cmd); }

  /* ---------- lifecycle / diagrams ---------- */
  .lc { display: flex; flex-direction: column; gap: 10px; }
  .lc .t { display: flex; align-items: baseline; gap: 10px; } .lc .t h3 { font-size: 16px; } .lc .t code { color: var(--muted); }
  .diagram { margin: 0; background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px; overflow-x: auto; }
  .diagram pre.mmd { margin: 0; font-family: var(--mono); font-size: 12px; color: var(--muted); white-space: pre; }
  .diagram svg { max-width: 100%; height: auto; display: block; margin: 0 auto; }
  .diagram figcaption { font-size: 12.5px; color: var(--muted); padding-top: 8px; }
  .kind { border-radius: 4px; padding: 2px 7px; font-family: var(--mono); font-size: 11px; font-weight: 500; }
  .kind.policy { background: var(--policy-soft); color: var(--policy); } .kind.event { background: var(--event-soft); color: var(--event); }
  .kind.cmd, .kind.svc { background: var(--cmd-soft); color: var(--cmd); } .kind.agg { background: var(--agg-soft); color: var(--agg); }
  .kind.lang { background: var(--lang-soft); color: var(--lang); } .kind.read { background: var(--sunk); color: var(--read); } .kind.hot { background: var(--hot-soft); color: var(--hot); }

  /* ---------- EventStorming strip ---------- */
  .strip { display: flex; flex-direction: column; gap: 10px; }
  .sentence { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 10px 0; border-top: 1px solid var(--line-soft); }
  .sentence:first-child { border-top: 0; padding-top: 0; }
  .sn { border-radius: 4px; padding: 9px 12px; font-family: var(--mono); font-size: 13px; border: 1px solid; box-shadow: 0 1px 0 rgba(6,27,49,.06); }
  .sn.cmd { background: var(--cmd-soft); color: var(--cmd); border-color: var(--cmd-edge); }
  .sn.agg { background: var(--agg-soft); color: var(--agg); border-color: var(--agg-edge); font-family: var(--sans); font-weight: 500; }
  .sn.ev { background: var(--event-soft); color: var(--event); border-color: var(--event-edge); }
  .sn[data-role]::before { content: attr(data-role); display: block; font-family: var(--sans); font-size: 10px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; opacity: .65; margin-bottom: 3px; }
  abbr.ref { text-decoration: underline dotted; text-underline-offset: 2px; cursor: help; color: var(--ink); font-weight: 500; }
  .refgist { color: var(--muted); font-size: .92em; }
  .glossary table td:first-child { font-weight: 500; color: var(--ink); white-space: nowrap; }
  .sn.mute { background: var(--surface); color: var(--muted); border-color: var(--line); border-style: dashed; }
  .arrow { color: var(--rule); font-size: 16px; }
  .then { font-size: 13px; color: var(--muted); font-style: italic; }

  /* ---------- blocks ---------- */
  .bgroup { display: flex; flex-direction: column; gap: 8px; }
  .bgroup-head { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; } .bgroup-head .why { font-size: 13px; color: var(--muted); }
  .bgroup-n { font-family: var(--mono); font-size: 11px; color: var(--muted); }
  .brows { list-style: none; margin: 0; padding: 0; background: var(--surface); border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
  .brow { display: flex; flex-direction: column; gap: 4px; padding: 12px 16px 12px 14px; border-left: 3px solid var(--rule); border-bottom: 1px solid var(--line-soft); }
  .brow:last-child { border-bottom: 0; }
  .brow.agg { border-left-color: var(--supporting); } .brow.cmd, .brow.svc { border-left-color: var(--svc); } .brow.lang { border-left-color: var(--core); }
  .brow.event { border-left-color: #C25E0A; } .brow.policy { border-left-color: #6845B8; } .brow.read { border-left-color: var(--read); }
  .brow-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; } .brow-name { font-weight: 500; font-size: 15px; }
  .brow-purpose { font-size: 14px; line-height: 1.5; color: var(--ink-2); max-width: 90ch; }
  .brow-list { font-size: 13.5px; color: var(--ink-2); }
  .brow-meta { display: flex; flex-wrap: wrap; gap: 4px 14px; font-family: var(--mono); font-size: 11px; color: var(--muted); }
  .ghost { border: 1px dashed var(--rule); color: var(--muted); border-radius: 4px; padding: 3px 8px; font-family: var(--mono); font-size: 11px; }
  .pills { display: flex; flex-wrap: wrap; gap: 6px; }

  /* ---------- responsive ---------- */
  @media (max-width: 1100px) { .canvas { grid-template-columns: 1fr 1fr; } .canvas .mid { grid-column: 1 / -1; order: -1; } }
  @media (max-width: 900px) {
    .layout { grid-template-columns: 1fr; }
    .main { padding: 20px 16px 72px; }
    .topbar { padding: 0 16px; gap: 10px; } .topmeta { display: none; }
    .rail { position: static; height: auto; border-right: 0; border-bottom: 1px solid var(--line); display: flex; align-items: center; gap: 6px; overflow-x: auto; scrollbar-width: none; padding: 10px 16px; }
    .rail::-webkit-scrollbar { display: none; }
    .rail-group { display: contents; } .rail-head { padding: 0 6px 0 10px; white-space: nowrap; }
    .rail-item { flex: none; width: auto; min-height: 0; padding: 6px 12px; border-radius: 999px; border: 1px solid var(--line); gap: 7px; }
    .rail-item[aria-current="true"] { border-color: var(--ink); background: var(--surface); }
    .rail-name { font-size: 13px; white-space: nowrap; } .rail .ring { display: none; }
    .chipnav { margin: 0 -16px; padding: 8px 16px; }
    .band { grid-template-columns: 1fr; padding: 14px 16px; gap: 10px; } .band-label { padding-left: 0; flex-direction: row; align-items: baseline; gap: 10px; }
    .tile { width: calc(50% - 6px); }
    .canvas { grid-template-columns: 1fr; } .canvas .mid { order: 0; }
    .cover { grid-template-columns: repeat(3, 1fr); } .cover a { flex-direction: row; align-items: center; } .cover a i { width: 10px; height: 10px; border-radius: 50%; flex: none; }
  }
  @media (max-width: 560px) {
    .tile { width: 100%; } .smap svg.edges { display: none; }
    .rule { grid-template-columns: 1fr; gap: 2px; }
    .sentence { gap: 6px; } .sentence .arrow { display: none; } .sentence .sn { width: 100%; }
    .panel, .cv, .agg { padding: 16px; }
  }
</style>
"""

_ARTIFACT_MARKUP = """<header class="topbar">
  <a class="brand" href="#" id="home"><span class="mark" id="mark">V</span><span id="app-name"></span></a>
  <nav class="crumbs" id="crumbs" aria-label="Breadcrumb"></nav>
  <div class="topmeta" id="app-meta"></div>
</header>
<script type="module">
  import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.esm.min.mjs";
  mermaid.initialize({
    startOnLoad: false, securityLevel: "strict", theme: "base",
    themeVariables: { fontFamily: "Instrument Sans, ui-sans-serif, system-ui, sans-serif", fontSize: "14px",
      primaryColor: "#FFFFFF", primaryTextColor: "#061B31", primaryBorderColor: "#50617A", lineColor: "#50617A",
      secondaryColor: "#F8FAFD", tertiaryColor: "#E5EDF5", edgeLabelBackground: "#FFFFFF" },
    state: { useMaxWidth: true }
  });
  window.__mermaid = mermaid;
  document.dispatchEvent(new Event("mermaid-ready"));
</script>
<div class="layout">
  <nav class="rail" id="rail" aria-label="Domains"></nav>
  <main class="main"><div class="wrap" id="view"></div></main>
</div>
"""

_ARTIFACT_SCRIPT = r"""<script>
const MODEL = __PAYLOAD__;
const FACETS = __FACETS__;
const TONES = __TONES__;
const GAP_KINDS = __GAPKINDS__;
const KIND_ORDER = __KINDORDER__;
const SHARED = "__shared__";
// DDD terms keep their DDD wording (references/glossary.md); status adds a short hint.
const VI = {
  status: { observed: "observed · exists in code", target: "target · agreed goal", proposed: "proposed · not yet agreed", unknown: "unknown · unclear", accepted: "accepted · approved", superseded: "superseded · replaced", rejected: "rejected · turned down", open: "open · awaiting answer", resolved: "resolved · answered", deferred: "deferred · for later" },
  type: { core: "core", supporting: "supporting", generic: "generic", unknown: "unknown" },
  ruleKind: { invariant: "invariant", policy: "policy", specification: "specification", authorization: "authorization", uniqueness: "uniqueness", workflow: "workflow", rule: "rule", unknown: "unknown" },
  relKind: { PORT: "port", EVENT: "event", REFERENCE: "reference", SHARED_KERNEL: "shared kernel", EXTERNAL: "external" },
  lcKind: { "state-machine": "state machine", lifecycle: "lifecycle", workflow: "workflow", unknown: "" },
  pattern: { "shared-kernel": "shared kernel", "open-host-service": "open-host service", "published-language": "published language", "customer-supplier": "customer–supplier", "anti-corruption-layer": "anti-corruption layer", conformist: "conformist", partnership: "partnership", "upstream-downstream": "upstream–downstream", "separate-ways": "separate ways" },
};
const GLOSSARY = __GLOSSARY__;
const BUSINESS_GLOSSARY = __BUSINESS_GLOSSARY__;
// D12 / OQ8 -> short gist, so a reader never has to go and look a code up.
const REFS = (() => { const out = {}; const gist = (t) => { t = String(t || "").replace(/\s+/g, " ").trim(); let o = ""; for (const p of t.split(/(?<=[.;])\s/)) { if (o && o.length >= 60) break; o = (o + " " + p).trim(); } o = o.replace(/\s*\[[^\]]*\]\s*$/, "").replace(/[.; ]+$/, ""); return o.length <= 120 ? o : o.slice(0, 117).trimEnd() + "…"; };
  for (const d of (MODEL.decisions || [])) { const m = /^d(\d+)-/.exec(d.id || ""); if (m) { let g = gist(d.decision); if (d.status === "superseded") { const by = /^d(\d+)-/.exec(d.supersededBy || ""); g = (by ? "superseded by D" + by[1] : "superseded") + ": " + g; } out["D" + m[1]] = { gist: g, full: d.decision }; } }
  for (const q of (MODEL.openQuestions || [])) { const m = /^oq(\d+)-/.exec(q.id || ""); if (m) out["OQ" + m[1]] = { gist: gist(q.question), full: q.question }; }
  return out; })();
const REF_RE = /\b(D|OQ)(\d{1,3})\b(?![-\w])(?=[^(]|$)/g;
function annotateRefs(root) {
  const skip = new Set(["CODE", "PRE", "ABBR", "SCRIPT", "STYLE", "SVG"]);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: (n) => { let p = n.parentElement; while (p && p !== root) { if (skip.has(p.tagName) || p.classList.contains("k") || p.classList.contains("sn") || p.classList.contains("fld") || p.classList.contains("res") || p.classList.contains("refgist")) return NodeFilter.FILTER_REJECT; p = p.parentElement; } return REF_RE.test(n.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT; } });
  const nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const n of nodes) {
    const frag = document.createDocumentFragment(); let last = 0; const text = n.nodeValue; REF_RE.lastIndex = 0; let m;
    while ((m = REF_RE.exec(text))) { const key = m[0]; const ref = REFS[key]; if (!ref) continue;
      frag.appendChild(document.createTextNode(text.slice(last, m.index)));
      const ab = document.createElement("abbr"); ab.className = "ref"; ab.title = ref.full; ab.textContent = key; frag.appendChild(ab);
      const after = text.slice(m.index + key.length); const before = text.slice(Math.max(0, m.index - 1), m.index);
      if (!/^\s*[(—:]/.test(after)) { const g = document.createElement("span"); g.className = "refgist"; g.textContent = (before === "(" || /^\)/.test(after)) ? ": " + ref.gist : " (" + ref.gist + ")"; frag.appendChild(g); }
      last = m.index + key.length; }
    frag.appendChild(document.createTextNode(text.slice(last))); n.parentNode.replaceChild(frag, n);
  }
}
const vi = (map, k) => (VI[map] && VI[map][k]) || k || "";

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const arr = (v) => Array.isArray(v) ? v : [];
const contexts = arr(MODEL.contexts);
const blocks = arr(MODEL.buildingBlocks);
const relations = arr(MODEL.relations);
const byId = new Map(contexts.map((c) => [c.id, c]));
const tone = (kind) => TONES[kind] || "read";
const mid = (v) => String(v ?? "").replace(/[^A-Za-z0-9_]/g, "_");
const nameOf = (id) => (byId.get(id) || {}).name || id;
const typeOf = (id) => (byId.get(id) || {}).domainType || "unknown";

// ---------------------------------------------------------------- derivations
const ownBlocks = (cid) => blocks.filter((b) => b.context === cid);
const sharedBlocks = () => blocks.filter((b) => !b.context);
const aggsOf = (c) => arr(c && c.aggregates);
const relsOf = (cid) => relations.filter((r) => r.from === cid || r.to === cid);
const ID_RE = /(code|_id|id|uid|ref|number|no)$/i;
function identityOf(a) {
  const fields = arr(a.fields).filter((f) => f.identity !== false);
  const flagged = fields.filter((f) => f.identity === true);
  const strong = fields.filter((f) => f.kind === "primitive" && f.required && f.readOnly);
  const named = fields.filter((f) => f.kind === "primitive" && (ID_RE.test(String(f.type || "")) || /(^|_)(code|uid|number|no)$/i.test(String(f.name || ""))));
  const pick = flagged[0] || strong[0] || named[0];
  if (!pick) return null;
  const prim = blocks.find((b) => b.kind === "domain-primitive" && b.aggregate === a.id && (b.name === pick.type || (b.name || "").includes(pick.type)));
  const rule = arr(a.invariants).find((i) => i.toLowerCase().includes(String(pick.name).toLowerCase()) || i.includes(String(pick.type)));
  return { field: pick.name, type: pick.type, note: (prim && prim.purpose) || pick.description || rule || "" };
}
function termsOf(cid) {
  const kinds = new Set(["value-object", "domain-primitive", "shared-kernel"]);
  const out = ownBlocks(cid).filter((b) => kinds.has(b.kind)).map((b) => ({ name: b.name, note: b.purpose, src: b.kind }));
  const seen = new Set(out.map((t) => t.name));
  for (const a of aggsOf(byId.get(cid))) for (const f of arr(a.fields)) {
    if ((f.kind === "value-object" || f.kind === "entity") && f.type && !seen.has(f.type) && !/^(json|string|datetime|date|boolean|integer|float|number|enum)$/i.test(f.type)) { seen.add(f.type); out.push({ name: f.type, note: `Type of field ${f.name} on ${a.name}` + (f.description ? `: ${f.description}` : ""), src: f.kind }); }
  }
  return out;
}
const lifecyclesOf = (cid) => aggsOf(byId.get(cid)).filter((a) => a.lifecycle && arr(a.lifecycle.states).length).map((a) => ({ agg: a.name, lc: a.lifecycle }));
function commandsOf(cid) {
  const c = byId.get(cid);
  const out = arr(c && c.useCases).map((u) => ({ name: u.name || u, note: u.description, from: u.actor || "use case" }));
  const seen = new Set(out.map((o) => o.name));
  for (const { agg, lc } of lifecyclesOf(cid)) for (const t of arr(lc.transitions)) {
    const key = agg + "." + t.action; if (seen.has(key)) continue; seen.add(key);
    out.push({ name: t.action, note: t.description || `${t.from} → ${t.to}`, from: agg });
  }
  for (const b of ownBlocks(cid).filter((b) => b.kind === "command")) out.push({ name: b.name, note: b.purpose, from: "command" });
  return out;
}
function eventsOf(cid) {
  const c = byId.get(cid);
  const out = arr(c && c.events).map((e) => ({ name: e.name || e, id: e.id, note: e.description, from: "declared", consumers: arr(e.consumers) }));
  const seen = new Set(out.map((o) => o.name).concat(out.map((o) => o.id)));
  const push = (name, note, from) => { if (name && !seen.has(name)) { seen.add(name); out.push({ name, note, from, consumers: [] }); } };
  for (const a of aggsOf(c)) for (const e of arr(a.events)) push(e.name || e, e.description, a.name);
  for (const { agg, lc } of lifecyclesOf(cid)) for (const t of arr(lc.transitions)) for (const e of arr(t.emits)) push(e, `Emitted on ${t.action}`, agg);
  for (const b of ownBlocks(cid).filter((b) => b.kind === "domain-event")) push(b.name, b.purpose, "building block");
  return out;
}
function flowsOf(cid) {
  const out = [];
  for (const { agg, lc } of lifecyclesOf(cid)) for (const t of arr(lc.transitions)) for (const e of arr(t.emits)) out.push({ cmd: t.action, agg, event: e, side: arr(t.sideEffects).join("; ") });
  return out;
}
function mutesOf(cid) {
  const emitting = new Set(flowsOf(cid).map((f) => f.cmd)); const all = new Set();
  for (const { lc } of lifecyclesOf(cid)) for (const t of arr(lc.transitions)) all.add(t.action);
  return [...all].filter((a) => !emitting.has(a));
}
function rulesOf(cid) {
  const c = byId.get(cid);
  const out = arr(c && c.rules).map((r) => ({ ...r, on: c.name }));
  for (const a of aggsOf(c)) { for (const r of arr(a.rules)) out.push({ ...r, on: a.name }); for (const inv of arr(a.invariants)) out.push({ description: inv, kind: "invariant", on: a.name }); }
  for (const b of ownBlocks(cid).filter((b) => b.kind === "policy" || b.kind === "specification")) out.push({ id: b.id, description: b.purpose, kind: b.kind, on: b.aggregate || (c && c.name) });
  return out;
}
const escRe = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const touches = (item, ctx) => {
  if (Array.isArray(item.contexts)) return item.contexts.includes(ctx.id);
  const text = JSON.stringify(Object.fromEntries(Object.entries(item).filter(([k]) => k !== "id")));
  if (new RegExp("(^|[^\\w-])" + escRe(ctx.id) + "\\.[a-z]").test(text)) return true;
  return !!ctx.name && text.toLowerCase().includes(ctx.name.toLowerCase());
};
const questionsTouching = (ctx) => arr(MODEL.openQuestions).filter((q) => touches(q, ctx));
const decisionsTouching = (ctx) => arr(MODEL.decisions).filter((d) => touches(d, ctx));
function counts(cid) {
  const c = byId.get(cid); const own = cid === SHARED ? sharedBlocks() : ownBlocks(cid);
  return { purpose: (c && (c.businessCapability || c.description)) ? 1 : 0, language: termsOf(cid).length, aggregates: aggsOf(c).length, blocks: own.length,
    lifecycle: lifecyclesOf(cid).length, commands: commandsOf(cid).length, events: eventsOf(cid).length, rules: rulesOf(cid).length, integration: relsOf(cid).length + questionsTouching(c || { id: cid }).length };
}
const domains = [
  ...contexts.map((c) => ({ id: c.id, name: c.name || c.id, type: c.domainType || "unknown", ctx: c })),
  ...(sharedBlocks().length ? [{ id: SHARED, name: "Shared kernel", type: "generic", ctx: null }] : []),
];
const filledOf = (id) => { const n = counts(id); return FACETS.filter((f) => n[f[0]]).length; };

// ---------------------------------------------------------------- atoms
let state = { view: "landscape" };
const chip = (t, cls) => `<span class="chip ${cls || ""}">${esc(t)}</span>`;
const statusChip = (st) => st ? chip(vi("status", st), (st === "target" || st === "proposed" || st === "unknown") ? "hot" : ((st === "observed" || st === "accepted") ? "" : "quiet")) : "";
const typeChip = (t) => `<span class="chip ${esc(t)} up"><i class="dot ${esc(t)}"></i>${esc(vi("type", t))}</span>`;
const plural = (n, one) => `${n} ${one}`;
const empty = (what, why) => `<div class="empty"><b>${esc(what)}: nothing recorded.</b> ${esc(why)}</div>`;
const table = (head, rows) => rows.length ? `<div class="tablewrap"><table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>` : "";
const ring = (filled, total) => { const r = 6, c = 2 * Math.PI * r; return `<svg class="ring" viewBox="0 0 16 16" aria-hidden="true"><circle class="bg" cx="8" cy="8" r="${r}"/><circle class="fg" cx="8" cy="8" r="${r}" stroke-dasharray="${(c * filled / total).toFixed(2)} ${c.toFixed(2)}"/></svg>`; };
const diagram = (code, caption) => `<figure class="diagram"><pre class="mmd">${esc(code)}</pre>${caption ? `<figcaption>${esc(caption)}</figcaption>` : ""}</figure>`;
function lifecycleMermaid(lc) {
  const lines = ["stateDiagram-v2", "  direction LR", `  [*] --> ${mid(lc.initial)}`];
  const trans = arr(lc.transitions);
  for (const t of trans) { const g = arr(t.guards).map((x) => x.split(".").pop()).join(", "); lines.push(`  ${mid(t.from)} --> ${mid(t.to)}: ${String(t.action).replace(/[<>"]/g, "")}${g ? " [" + g.replace(/[<>"]/g, "") + "]" : ""}`); }
  for (const st of arr(lc.states)) { const n = st.name || st; if (st.terminal || !trans.some((t) => t.from === n)) lines.push(`  ${mid(n)} --> [*]`); }
  return lines.join("\n");
}
async function drawDiagrams() {
  const m = window.__mermaid;
  if (!m) { document.addEventListener("mermaid-ready", drawDiagrams, { once: true }); return; }
  const nodes = [...document.querySelectorAll("pre.mmd:not([data-processed])")];
  if (nodes.length) { try { await m.run({ nodes }); } catch (e) { console.warn("mermaid", e); } }
}

// ---------------------------------------------------------------- landscape
const qaDate = (x) => { for (const src of arr(x.sources)) { const m = /(\d{4}-\d{2}-\d{2})/.exec(String(src)); if (m) return m[1]; } return ""; };
const qaNum = (id) => { const m = /(\d+)/.exec(String(id || "")); return m ? parseInt(m[1], 10) : 0; };
const ctxLinks = (ids) => arr(ids).map((cid) => { const c = byId.get(cid); return c ? `<a href="#" data-go="${esc(cid)}">${esc(c.name)}</a>` : esc(cid); }).join(", ");
function renderQA() {
  const qs = arr(MODEL.openQuestions).slice().sort((a, b) => qaNum(b.id) - qaNum(a.id));
  const open = qs.filter((q) => (q.status || "open") === "open"), deferred = qs.filter((q) => q.status === "deferred"), resolved = qs.filter((q) => q.status === "resolved");
  const ds = arr(MODEL.decisions).slice().sort((a, b) => qaNum(b.id) - qaNum(a.id));
  const proposed = ds.filter((d) => d.status === "proposed"), accepted = ds.filter((d) => (d.status || "accepted") === "accepted"), rejected = ds.filter((d) => d.status === "rejected" || d.status === "superseded");
  const qCode = (q) => { const m = /^oq-?(\d+)/i.exec(q.id || ""); return m ? "OQ" + m[1] : esc(q.id); };
  const dCode = (d) => { const m = /^d(\d+)/i.exec(d.id || ""); return m ? "D" + m[1] : esc(d.id); };
  const qRows = (list) => list.map((q) => `<tr><td class="k">${qCode(q)}</td><td>${esc(q.question)}</td><td>${esc(q.impact || "")}</td><td>${ctxLinks(q.contexts)}</td><td>${esc(q.owner || "")}</td><td>${chip(vi("status", q.status || "open"), (q.status || "open") === "open" ? "hot" : "quiet")}</td></tr>`);
  const byOwner = {}; for (const q of open) { const k = q.owner || "unassigned"; (byOwner[k] = byOwner[k] || []).push(q); }
  const ownerGroups = Object.keys(byOwner).sort((a, b) => byOwner[b].length - byOwner[a].length).map((k) => `<div class="bgroup"><div class="bgroup-head"><span class="lbl">${esc(k)}</span><span class="bgroup-n">${byOwner[k].length}</span></div>${table(["Code", "Question", "Impact", "Context", "Who answers", "Status"], qRows(byOwner[k]))}</div>`).join("");
  const dRows = (list) => list.map((d) => `<tr><td class="k">${dCode(d)}</td><td class="k">${esc(qaDate(d))}</td><td>${esc(d.decision)}</td><td>${esc((d.supersededBy ? "Superseded by " + dCode({ id: d.supersededBy }) + ". " : "") + (d.rationale || ""))}</td><td>${ctxLinks(d.contexts)}</td><td>${chip(vi("status", d.status || "accepted"), d.status === "proposed" ? "hot" : (d.status === "rejected" || d.status === "superseded") ? "quiet" : "")}</td></tr>`);
  const dHead = ["Code", "Date", "Decision", "Why", "Context", "Status"];
  return `<header class="hero"><div><h1>Q&amp;A</h1><p class="sub">Every open question and every decision of the domain, in one place. Questions are grouped by who must answer. Decisions are newest first. Decide in the meeting, then record the result in <code>.context/decisions</code> and the model. This page only reflects it.</p></div>
      <div class="stats"><div class="stat"><b style="color:${open.length ? "var(--hot)" : "inherit"}">${open.length}</b><span>open</span></div><div class="stat"><b>${deferred.length}</b><span>deferred</span></div><div class="stat"><b>${resolved.length}</b><span>resolved</span></div><div class="stat"><b style="color:${proposed.length ? "var(--hot)" : "inherit"}">${proposed.length}</b><span>proposed</span></div><div class="stat"><b>${accepted.length}</b><span>accepted</span></div></div></header>
    <section class="sec" id="qa-open"><div class="sec-head"><h2>Open questions</h2><span class="why">By who answers, most questions first</span><span class="n">${open.length}</span></div>${open.length ? ownerGroups : empty("Open questions", "No open questions left.")}</section>
    ${deferred.length ? `<section class="sec"><details class="fold"><summary>Deferred · ${deferred.length}</summary><div style="margin-top:8px">${table(["Code", "Question", "Reopen when", "Context", "Who answers", "Status"], qRows(deferred))}</div></details></section>` : ""}
    ${resolved.length ? `<section class="sec"><details class="fold"><summary>Answered · ${resolved.length}</summary><div style="margin-top:8px">${table(["Code", "Question", "Answer", "Context", "Who answers", "Status"], qRows(resolved))}</div></details></section>` : ""}
    <section class="sec" id="qa-decisions"><div class="sec-head"><h2>Decisions</h2><span class="why">Log in time order, newest first. Proposals not yet signed off by the project owner are in red</span><span class="n">${ds.length}</span></div>
      ${proposed.length ? `<div class="bgroup"><div class="bgroup-head"><span class="lbl">Proposed, awaiting sign-off</span><span class="bgroup-n">${proposed.length}</span></div>${table(dHead, dRows(proposed))}</div>` : ""}
      <div class="bgroup"><div class="bgroup-head"><span class="lbl">Accepted</span><span class="bgroup-n">${accepted.length}</span></div>${table(dHead, dRows(accepted))}</div>
      ${rejected.length ? `<details class="fold"><summary>Rejected or superseded · ${rejected.length}</summary><div style="margin-top:8px">${table(dHead, dRows(rejected))}</div></details>` : ""}
    </section>`;
}
function renderLandscape() {
  const sm = MODEL.strategicModel || {};
  const nAgg = contexts.reduce((n, c) => n + aggsOf(c).length, 0);
  const nq = arr(MODEL.openQuestions).filter((q) => (q.status || "open") === "open").length;
  const observed = contexts.filter((c) => c.status === "observed").length;
  const bands = [["core", "Core", "Invest here: what makes the platform different"], ["supporting", "Supporting", "Needed, but every competitor needs it"], ["generic", "Generic", "Plumbing: buy or keep thin"], ["unknown", "Unknown", "Not classified: decide before building"]];
  const tiles = (type) => domains.filter((d) => d.type === type).map((d) => {
    const c = d.ctx || {}; const f = filledOf(d.id);
    return `<button class="tile ${esc(d.type)} ${c.status === "target" ? "target" : ""}" data-tile="${esc(d.id)}" data-go="${esc(d.id)}" title="${esc(d.name)}">
      <h3>${esc(d.name)}</h3>
      ${c.label ? `<span class="addon">${esc(c.label)}</span>` : `<span class="addon">${c.status === "target" ? "no code yet" : ""}</span>`}
      <span class="foot"><span>${plural(aggsOf(c).length, "aggregate")}</span><span style="display:inline-flex;align-items:center;gap:5px">${ring(f, FACETS.length)}${f}/${FACETS.length}</span></span>
    </button>`;
  }).join("");
  const bandHtml = bands.filter(([t]) => domains.some((d) => d.type === t)).map(([t, label, why]) =>
    `<div class="band ${t}"><div class="band-label"><b>${label}</b><span>${why}</span></div><div class="tiles">${tiles(t)}</div></div>`).join("");
  return `<header class="hero">
      <div><h1>Domain map ${esc(MODEL.application || "")}</h1>
        <p class="sub">${esc(contexts.length)} bounded context, ${observed} observed (exists in code). Click a tile to read that context's dossier. Hover a tile to see who it talks to. DDD terms keep their DDD wording; see <a href="#glossary" data-go-glossary>Glossary</a>.</p>
        <div class="meta" style="margin-top:10px">${chip("v" + (MODEL.version || "?"), "quiet")}${MODEL.status ? chip(MODEL.status, MODEL.status === "proposed" ? "hot" : "") : ""}${MODEL.generatedAt ? chip(MODEL.generatedAt, "quiet") : ""}</div></div>
      <div class="stats"><div class="stat"><b>${contexts.length}</b><span>contexts</span></div><div class="stat"><b>${nAgg}</b><span>aggregates</span></div><div class="stat"><b>${relations.length}</b><span>relations</span></div><div class="stat"><b style="color:${nq ? "var(--hot)" : "inherit"}">${nq}</b><span>open questions</span></div></div>
    </header>
    <section class="sec"><div class="sec-head"><h2>Strategic map</h2><span class="why">Each row is a subdomain type, which means a level of investment. Hover a tile to light up its links. Solid lines exist in code, dashed lines are planned.</span></div>
      <div class="smap" id="smap"><svg class="edges" aria-hidden="true"></svg>${bandHtml}</div>
      <div class="legend"><span><i></i>port (direct call)</span><span><i class="ev"></i>event (emitted, the other side listens)</span><span><i class="ref"></i>reference (data link)</span><span><i class="tg"></i>target (dashed tile = no code yet)</span><span>Shared kernel (Platform) has no links drawn. Every context uses it.</span></div>
    </section>
    ${sm.classificationRationale ? `<details class="fold"><summary>Why this classification</summary><div class="panel" style="margin-top:8px;font-size:15px;color:var(--ink-2);max-width:80ch">${esc(sm.classificationRationale)}</div></details>` : ""}
    <section class="sec glossary" id="glossary"><div class="sec-head"><h2>Glossary</h2><span class="why">Business language, then DDD terms. One line per word, written the way the team says it</span></div>
      <details class="fold" open><summary>Business language · ${BUSINESS_GLOSSARY.length} terms</summary><div style="margin-top:8px">${table(["Term", "Meaning"], BUSINESS_GLOSSARY.map(([t, m]) => `<tr><td>${esc(t)}</td><td>${esc(m)}</td></tr>`))}</div></details>
      <details class="fold" id="glossary-ddd"><summary>DDD terms · ${GLOSSARY.length} terms</summary><div style="margin-top:8px">${table(["Term", "Meaning"], GLOSSARY.map(([t, m]) => `<tr><td>${esc(t)}</td><td>${esc(m)}</td></tr>`))}</div></details></section>
    ${nq ? `<section class="sec"><div class="sec-head"><h2>Open questions</h2><span class="why">Recorded here, decided in the meeting, never decided on this page</span><span class="n">${nq}</span><a href="#" data-go="qa" style="font-size:14px">See every question and the decision log in Q&amp;A</a></div><div class="grid2">${arr(MODEL.openQuestions).filter((q) => (q.status || "open") === "open").map((q) =>
      `<div class="hot"><p>${esc(q.question)}</p><span class="sub">${q.impact ? esc(q.impact) + " " : ""}${q.owner ? `<b>· who answers: ${esc(q.owner)}</b>` : ""}</span></div>`).join("")}</div></section>` : ""}`;
}
function drawMapEdges() {
  const map = document.querySelector("#smap"); if (!map) return;
  const svg = map.querySelector("svg.edges"); const R = map.getBoundingClientRect();
  const pos = (id) => { const el = map.querySelector(`[data-tile="${CSS.escape(id)}"]`); if (!el) return null; const b = el.getBoundingClientRect(); return { x: b.left - R.left + b.width / 2, y: b.top - R.top + b.height / 2, w: b.width, h: b.height }; };
  svg.setAttribute("viewBox", `0 0 ${R.width} ${R.height}`);
  const paths = [];
  for (const r of relations) {
    if (r.kind === "SHARED_KERNEL") continue;
    const a = pos(r.from), b = pos(r.to); if (!a || !b) continue;
    let x1 = a.x, y1 = a.y, x2 = b.x, y2 = b.y, d;
    if (Math.abs(a.y - b.y) > a.h) { y1 = b.y > a.y ? a.y + a.h / 2 : a.y - a.h / 2; y2 = b.y > a.y ? b.y - b.h / 2 : b.y + b.h / 2; const dy = (y2 - y1) / 2; d = `M${x1},${y1} C${x1},${y1 + dy} ${x2},${y2 - dy} ${x2},${y2}`; }
    else { x1 = b.x > a.x ? a.x + a.w / 2 : a.x - a.w / 2; x2 = b.x > a.x ? b.x - b.w / 2 : b.x + b.w / 2; const dx = (x2 - x1) / 2; const bow = (a.y === b.y ? -22 : 0); d = `M${x1},${y1} C${x1 + dx},${y1 + bow} ${x2 - dx},${y2 + bow} ${x2},${y2}`; }
    paths.push(`<path d="${d}" class="e-${r.kind.toLowerCase()} ${r.status === "target" ? "target" : ""}" data-from="${esc(r.from)}" data-to="${esc(r.to)}" marker-end="url(#arr)"/>`);
  }
  svg.innerHTML = `<defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,1 L9,5 L0,9 z" fill="context-stroke"/></marker></defs>${paths.join("")}`;
  map.querySelectorAll(".tile").forEach((t) => {
    t.addEventListener("mouseenter", () => { const id = t.dataset.tile; map.classList.add("focus");
      svg.querySelectorAll("path").forEach((p) => p.classList.toggle("on", p.dataset.from === id || p.dataset.to === id));
      const linked = new Set([id]); svg.querySelectorAll("path.on").forEach((p) => { linked.add(p.dataset.from); linked.add(p.dataset.to); });
      map.querySelectorAll(".tile").forEach((x) => x.classList.toggle("on", linked.has(x.dataset.tile))); });
    t.addEventListener("mouseleave", () => { map.classList.remove("focus"); map.querySelectorAll(".on").forEach((x) => x.classList.remove("on")); });
  });
}

// ---------------------------------------------------------------- dossier
const SECTIONS = [
  ["canvas", "Canvas", (n) => n.purpose + n.language + n.commands + n.events + n.rules],
  ["aggregates", "Aggregates", (n) => n.aggregates],
  ["lifecycle", "Lifecycle", (n) => n.lifecycle],
  ["flow", "Events", (n) => n.events],
  ["blocks", "Building blocks", (n) => n.blocks],
  ["rules", "Rules", (n) => n.rules],
  ["integration", "Integration", (n) => n.integration],
];
function renderDomain(id) {
  const d = domains.find((x) => x.id === id); if (!d) return renderLandscape();
  const c = d.ctx || {}; const n = counts(id); const gaps = FACETS.filter((f) => !n[f[0]]);
  const head = `<header class="dhead">
    <div class="row"><h1>${esc(d.name)}</h1>${typeChip(d.type)}${statusChip(c.status)}</div>
    ${c.businessCapability ? `<p class="cap">${esc(c.businessCapability)}</p>` : ""}
    <div class="row">${c.label ? `<span class="chip"><code>${esc(c.label)}</code></span>` : ""}${c.strategicImportance ? chip("importance · " + c.strategicImportance) : ""}${arr(c.contextMapPatterns).map((p) => chip(vi("pattern", p), "quiet")).join("")}${c.owner ? chip("owner · " + c.owner, "quiet") : ""}</div>
    <div class="cover" title="${FACETS.length - gaps.length}/${FACETS.length} facets filled">${FACETS.map((f) => `<a href="#f-${sectionFor(f[0])}" class="${n[f[0]] ? "" : "gap"}"><i></i><span>${esc(f[3])}</span></a>`).join("")}</div>
  </header>
  <nav class="chipnav" id="chipnav" aria-label="Sections">${SECTIONS.map(([k, label, cnt]) => `<a href="#f-${k}">${label}<span class="n">${cnt(n)}</span></a>`).join("")}</nav>`;
  const secs = [
    sec("canvas", "Bounded Context Canvas", "Inbound: who calls in · middle: what this context owns · Outbound: what it emits", fCanvas(d)),
    sec("aggregates", "Aggregates", "Each aggregate is data that must stay correct together, recognised by one identity", fAggregates(d)),
    sec("lifecycle", "Lifecycle", "Each arrow reads: command [guard that must hold]", fLifecycle(d)),
    sec("flow", "Event flow", "command → aggregate → event, read from the lifecycle (EventStorming)", fFlow(d)),
    sec("blocks", "Identity & building blocks", "Identity of each aggregate, and the building blocks in DDD order", fBlocks(d)),
    sec("rules", "Rules & policies", "Invariants, policies, specifications, authorization: the named rules of this context", fRules(d)),
    sec("integration", "Integration & open questions", "Which contexts it works with, through what; what is unclear; related decisions", fIntegration(d)),
  ];
  return head + secs.join("");
}
const sectionFor = (facet) => ({ purpose: "canvas", language: "canvas", commands: "canvas", events: "flow", aggregates: "aggregates", blocks: "blocks", lifecycle: "lifecycle", rules: "rules", integration: "integration" })[facet] || "canvas";
const sec = (k, title, why, body) => `<section class="sec" id="f-${k}"><div class="sec-head"><h2>${esc(title)}</h2><span class="why">${esc(why)}</span></div>${body}</section>`;

function fCanvas(d) {
  const c = d.ctx; const id = d.id;
  const inb = relsOf(id).filter((r) => r.to === id && r.kind !== "SHARED_KERNEL");
  const outb = relsOf(id).filter((r) => r.from === id && r.kind !== "SHARED_KERNEL");
  const msg = (cls, title, who, note) => `<div class="msg ${cls}"><b>${esc(title)}</b>${note ? `<span>${esc(note)}</span>` : ""}${who ? `<span class="who">${esc(who)}</span>` : ""}</div>`;
  const inbound = [
    ...inb.filter((r) => r.kind !== "EVENT").map((r) => msg("cmd", r.via || vi("relKind", r.kind), "from " + nameOf(r.from) + (r.status === "target" ? " · target" : ""), r.description)),
    ...inb.filter((r) => r.kind === "EVENT").map((r) => msg("ev", r.via || "event", "listens to " + nameOf(r.from) + (r.status === "target" ? " · target" : ""), r.description)),
    ...commandsOf(id).filter((x) => x.from !== "command").slice(0, 8).map((x) => msg("cmd", x.name, "command on " + x.from, x.note)),
  ];
  const outbound = [
    ...outb.filter((r) => r.kind === "EVENT").map((r) => msg("ev", r.via || "event", "to " + nameOf(r.to) + (r.status === "target" ? " · target" : ""), r.description)),
    ...outb.filter((r) => r.kind !== "EVENT").map((r) => msg("cmd", r.via || vi("relKind", r.kind), "calls " + nameOf(r.to) + (r.status === "target" ? " · target" : ""), r.description)),
  ];
  const terms = termsOf(id);
  const rules = rulesOf(id).filter((r) => r.kind === "policy" || r.kind === "invariant").slice(0, 6);
  const sm = MODEL.strategicModel || {}; const sub = arr(sm.subdomains).find((s) => arr(s.contextIds).includes(id));
  const mid_ = `<div class="cv mid">
      ${c && c.description ? `<div class="kv"><span class="lbl">What this context does</span><p>${esc(c.description)}</p></div>` : ""}
      ${sub ? `<div class="kv"><span class="lbl">Subdomain</span><p><b style="font-weight:500">${esc(sub.name)}</b> · ${typeChip(sub.domainType)}</p>${sub.description ? `<p style="font-size:14px;color:var(--ink-2)">${esc(sub.description)}</p>` : ""}</div>` : ""}
      <div class="kv"><span class="lbl">Ubiquitous language</span>${terms.length ? `<div class="terms">${terms.map((t) => `<span class="term" title="${esc(t.note || "")}">${esc(t.name)}</span>`).join("")}</div>` : `<p style="font-size:14px;color:var(--muted)">No words declared for this domain. A word can mean something else in the next domain without anyone noticing.</p>`}</div>
      <div class="kv"><span class="lbl">Key rules</span>${rules.length ? `<div class="rulelist">${rules.map((r) => `<div class="rule"><span class="kind">${esc(vi("ruleKind", r.kind))}</span><span>${esc(r.description)}</span></div>`).join("")}</div>` : `<p style="font-size:14px;color:var(--muted)">No rules recorded.</p>`}</div>
    </div>`;
  return `<div class="canvas">
    <div class="cv in"><h3>Inbound <small>${inbound.length}</small></h3>${inbound.length ? inbound.join("") : `<p style="font-size:14px;color:var(--muted)">No one asks this domain to do anything yet.</p>`}</div>
    ${mid_}
    <div class="cv out"><h3>Outbound <small>${outbound.length}</small></h3>${outbound.length ? outbound.join("") : `<p style="font-size:14px;color:var(--muted)">This domain tells no one anything. Nothing elsewhere can react.</p>`}</div>
  </div>`;
}
function fAggregates(d) {
  const aggs = aggsOf(d.ctx); if (!aggs.length) return empty("Aggregate", "No aggregate owns its own rules in this domain.");
  return `<div class="aggs">${aggs.map((a) => { const idn = identityOf(a); return `<article class="agg">
    <div class="top"><h3>${esc(a.name)}</h3>${statusChip(a.status)}</div>
    ${a.resource ? `<span class="res">${esc(a.resource)}</span>` : ""}
    ${a.description ? `<p class="desc">${esc(a.description)}</p>` : ""}
    ${idn ? `<div class="key"><span class="tag">Identity</span><div><b>${esc(idn.field)} : ${esc(idn.type)}</b>${idn.note ? `<span>${esc(idn.note)}</span>` : ""}</div></div>` : `<div class="key none"><span class="tag">Identity</span><div><b>no identity yet</b><span>No field names a single record, so two records cannot be told apart.</span></div></div>`}
    ${a.consistencyBoundary ? `<div class="bound">${esc(a.consistencyBoundary)}</div>` : ""}
    ${arr(a.invariants).length ? `<div><span class="lbl">Invariants</span><ul class="inv" style="margin-top:6px">${arr(a.invariants).map((i) => `<li>${esc(i)}</li>`).join("")}</ul></div>` : ""}
    ${arr(a.fields).length ? `<details class="fold"><summary>${plural(arr(a.fields).length, "fields")}</summary><div class="fields" style="margin-top:6px">${arr(a.fields).map((f) => `<span class="fld ${f.references ? "ref" : ""}" title="${esc(f.description || "")}">${esc(f.name)}${f.references ? " → " + esc(f.references) : ": " + esc(f.type)}</span>`).join("")}</div></details>` : ""}
  </article>`; }).join("")}</div>`;
}
function fLifecycle(d) {
  const lcs = lifecyclesOf(d.id); if (!lcs.length) return empty("Lifecycle", "Nothing here changes state in a way that changes what is allowed.");
  return lcs.map(({ agg, lc }) => { const trans = arr(lc.transitions);
    const rows = trans.map((t) => `<tr><td class="k">${esc(t.from)}</td><td class="k">${esc(t.action)}</td><td class="k">${esc(t.to)}</td>
      <td>${arr(t.guards).map((g) => `<span class="kind policy">${esc(g.split(".").pop())}</span>`).join(" ") || "<span class='ghost'>no guard</span>"}</td>
      <td>${arr(t.emits).map((e) => `<span class="kind event">${esc(e)}</span>`).join(" ")}</td>
      <td>${esc([...arr(t.sideEffects), t.description || ""].filter(Boolean).join(" · "))}${t.reversible === false ? ` <span class="kind hot">one-way</span>` : ""}${t.compensating ? ` <span class="kind read">compensating</span>` : ""}</td></tr>`);
    return `<div class="lc"><div class="t"><h3>${esc(agg)}</h3>${lc.stateType ? `<code>${esc(lc.stateType)}</code>` : ""}${lc.kind ? chip(vi("lcKind", lc.kind), "quiet") : ""}</div>
      ${lc.description ? `<p style="font-size:14px;color:var(--muted)">${esc(lc.description)}</p>` : ""}
      ${diagram(lifecycleMermaid(lc))}
      <details class="fold"><summary>${plural(trans.length, "transitions")}: guard, event emitted, what happens next</summary><div style="margin-top:8px">${table(["From", "Command", "To", "Guard", "Emits", "Then"], rows)}</div></details></div>`;
  }).join("");
}
function fFlow(d) {
  const flows = flowsOf(d.id); const es = eventsOf(d.id);
  if (!es.length && !flows.length) return empty("Events", "This context emits no events. Nothing elsewhere can react to what happens here.");
  const parts = [];
  if (flows.length) parts.push(`<div class="panel strip">${flows.map((f) => `<div class="sentence"><span class="sn cmd" data-role="command">${esc(f.cmd)}</span><span class="arrow">→</span><span class="sn agg" data-role="aggregate">${esc(f.agg)}</span><span class="arrow">→</span><span class="sn ev" data-role="event">${esc(f.event)}</span>${f.side ? `<span class="then">then ${esc(f.side)}</span>` : ""}</div>`).join("")}
    ${mutesOf(d.id).length ? `<div class="sentence">${mutesOf(d.id).map((m) => `<span class="sn mute" data-role="command">${esc(m)}</span>`).join("")}<span class="then" style="color:var(--hot);font-style:normal">emits no event, so nothing elsewhere can react</span></div>` : ""}</div>`);
  const extra = es.filter((e) => !flows.some((f) => f.event === e.name || f.event === e.id));
  if (extra.length) parts.push(table(["Event", "Happens when", "Who listens"], extra.map((e) => `<tr><td class="k">${esc(e.id || e.name)}</td><td>${esc(e.note || "")}</td><td>${esc(arr(e.consumers).join(", ") || e.from)}</td></tr>`)));
  return parts.join("");
}
function bbRow(b) {
  const t = tone(b.kind); const meta = [b.scope || "", b.aggregate ? "in " + b.aggregate : "", b.location || ""].filter(Boolean); const lists = [...arr(b.responsibilities), ...arr(b.invariants)];
  return `<li class="brow ${t}"><div class="brow-head"><span class="brow-name">${esc(b.name)}</span><span class="kind ${t}">${esc(b.kind)}</span></div>
    ${b.purpose ? `<p class="brow-purpose">${esc(b.purpose)}</p>` : ""}${lists.length ? `<ul class="brow-list">${lists.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>` : ""}
    ${meta.length ? `<div class="brow-meta">${meta.map((m) => `<span>${esc(m)}</span>`).join("")}</div>` : ""}</li>`;
}
function groupedBlocks(list) {
  const byKind = new Map(); for (const b of list) { if (!byKind.has(b.kind)) byKind.set(b.kind, []); byKind.get(b.kind).push(b); }
  const known = new Set(KIND_ORDER.map((k) => k[0])); const order = [...KIND_ORDER, ...[...byKind.keys()].filter((k) => !known.has(k)).map((k) => [k, k])];
  return order.filter(([k]) => byKind.has(k)).map(([k, label]) => `<div class="bgroup"><div class="bgroup-head"><span class="lbl">${esc(label)}</span><span class="bgroup-n">${byKind.get(k).length}</span></div><ul class="brows">${byKind.get(k).map(bbRow).join("")}</ul></div>`).join("");
}
function fBlocks(d) {
  const parts = []; const aggs = aggsOf(d.ctx);
  if (aggs.length) parts.push(`<div class="bgroup"><div class="bgroup-head"><span class="lbl">Identity</span><span class="bgroup-n">${aggs.length}</span><span class="why">what names exactly one record. It separates an entity from a value object</span></div>
    ${table(["Aggregate", "Field", "Type", "Rule"], aggs.map((a) => { const i = identityOf(a); return i ? `<tr><td class="k">${esc(a.name)}</td><td class="k">${esc(i.field)}</td><td><span class="kind lang">${esc(i.type)}</span></td><td>${esc(i.note)}</td></tr>` : `<tr><td class="k">${esc(a.name)}</td><td colspan="3"><span class="ghost">no identity yet</span></td></tr>`; }))}</div>`);
  const own = d.id === SHARED ? sharedBlocks() : ownBlocks(d.id); const shared = d.id === SHARED ? [] : sharedBlocks();
  parts.push(own.length ? groupedBlocks(own) : empty("Building blocks", "This context names no building blocks of its own. A code review has nothing to point at."));
  if (shared.length) parts.push(`<details class="fold"><summary>Borrowed from shared kernel · ${shared.length}</summary><div style="margin-top:8px">${groupedBlocks(shared)}</div></details>`);
  const have = new Set(own.map((b) => b.kind)); const missing = GAP_KINDS.filter((k) => !have.has(k));
  if (own.length && missing.length) parts.push(`<div class="empty"><b>Not modelled yet:</b> <span class="pills" style="display:inline-flex;margin:0 6px">${missing.map((k) => `<span class="ghost">${esc(k)}</span>`).join("")}</span> This is not always a gap: a supporting domain often keeps its rules inside the aggregate root. Saying so here beats finding out while reading code.</div>`);
  return parts.join("");
}
function fRules(d) {
  const rs = rulesOf(d.id); if (!rs.length) return empty("Rules", "No invariant or policy recorded for this context.");
  const byKind = new Map(); for (const r of rs) { const k = r.kind || "rule"; if (!byKind.has(k)) byKind.set(k, []); byKind.get(k).push(r); }
  const order = ["invariant", "policy", "specification", "authorization", "uniqueness", "workflow", "rule", "unknown"];
  return [...byKind.keys()].sort((a, b) => order.indexOf(a) - order.indexOf(b)).map((k) => `<div class="bgroup"><div class="bgroup-head"><span class="lbl">${esc(vi("ruleKind", k))}</span><span class="bgroup-n">${byKind.get(k).length}</span></div>
    ${table(["Rule", "Declared on", "Status"], byKind.get(k).map((r) => `<tr><td style="color:var(--ink)">${esc(r.description)}</td><td class="k">${esc(r.declaredOn || r.on || "")}</td><td>${statusChip(r.status)}</td></tr>`))}</div>`).join("");
}
function fIntegration(d) {
  const parts = []; const rels = relsOf(d.id);
  if (rels.length) parts.push(table(["Direction", "Context", "Kind", "Via", "Pattern", "Status"], rels.map((r) => { const outb = r.from === d.id; const other = outb ? r.to : r.from;
    return `<tr><td>${outb ? (r.kind === "EVENT" ? "notifies" : "calls") : (r.kind === "EVENT" ? "listens to" : "used by")}</td><td style="color:var(--ink);font-weight:500">${esc(nameOf(other))}</td><td><span class="kind ${r.kind === "EVENT" ? "event" : r.kind === "PORT" ? "cmd" : "read"}">${esc(vi("relKind", r.kind))}</span></td><td class="k" style="white-space:normal">${esc(r.via || "")}<div style="font-family:var(--sans);font-size:13px;color:var(--ink-2);margin-top:2px">${esc(r.description || "")}</div></td><td>${esc(vi("pattern", r.pattern || ""))}</td><td>${statusChip(r.status)}</td></tr>`; })));
  else parts.push(empty("Integration", "No relations declared. Either this context stands alone, or the context map is incomplete."));
  const qs = questionsTouching(d);
  if (qs.length) parts.push(`<div class="bgroup"><div class="bgroup-head"><span class="lbl">Open questions</span><span class="bgroup-n">${qs.length}</span></div><div class="grid2">${qs.map((q) => `<div class="hot"><p>${esc(q.question)}</p><span class="sub">${esc(q.impact || "")} ${q.owner ? `<b>· who answers: ${esc(q.owner)}</b>` : ""} ${q.status && q.status !== "open" ? chip(vi("status", q.status), "quiet") : ""}</span></div>`).join("")}</div></div>`);
  const ds = decisionsTouching(d);
  if (ds.length) parts.push(`<div class="bgroup"><div class="bgroup-head"><span class="lbl">Related decisions</span><span class="bgroup-n">${ds.length}</span></div>${table(["Decision", "Why", "Status"], ds.map((x) => `<tr><td style="color:var(--ink)">${esc(x.decision)}</td><td>${esc(x.rationale || "")}</td><td>${statusChip(x.status || "proposed")}</td></tr>`))}</div>`);
  return parts.join("");
}

// ---------------------------------------------------------------- chrome
function renderChrome() {
  const app = MODEL.application || "Domain model";
  document.querySelector("#app-name").textContent = app;
  document.querySelector("#mark").textContent = app.trim().charAt(0).toUpperCase() || "D";
  document.querySelector("#app-meta").innerHTML = [MODEL.version ? chip("v" + MODEL.version, "quiet") : "", MODEL.generatedAt ? chip(MODEL.generatedAt, "quiet") : ""].join("");
  const crumbs = document.querySelector("#crumbs");
  crumbs.innerHTML = state.view === "landscape" ? "" : `<span class="sep">/</span><a href="#" data-go="landscape">All contexts</a><span class="sep">/</span><span class="cur">${state.view === "qa" ? "Q&amp;A" : esc((domains.find((d) => d.id === state.view) || {}).name || "")}</span>`;
  const groups = [["core", "Core"], ["supporting", "Supporting"], ["generic", "Generic"], ["unknown", "Unknown"]];
  let rail = `<div class="rail-group"><button class="rail-item" data-go="landscape" aria-current="${state.view === "landscape"}"><span class="rail-name">All contexts</span><span class="mono">${domains.length}</span></button><button class="rail-item" data-go="qa" aria-current="${state.view === "qa"}"><span class="rail-name">Q&amp;A</span><span class="mono">${arr(MODEL.openQuestions).filter((q) => (q.status || "open") === "open").length}</span></button><button class="rail-item" data-go-glossary><span class="rail-name">Glossary</span><span class="mono">${BUSINESS_GLOSSARY.length + GLOSSARY.length}</span></button></div>`;
  for (const [type, label] of groups) { const list = domains.filter((d) => d.type === type); if (!list.length) continue;
    rail += `<div class="rail-group"><div class="rail-head">${esc(label)}</div>${list.map((d) => `<button class="rail-item" data-go="${esc(d.id)}" aria-current="${state.view === d.id}" title="${esc(d.name)} — ${filledOf(d.id)}/${FACETS.length} facets filled"><i class="dot ${esc(d.type)}"></i><span class="rail-name">${esc(d.name)}</span>${ring(filledOf(d.id), FACETS.length)}</button>`).join("")}</div>`; }
  document.querySelector("#rail").innerHTML = rail;
}
function render() {
  renderChrome();
  document.querySelector("#view").innerHTML = state.view === "landscape" ? renderLandscape() : state.view === "qa" ? renderQA() : renderDomain(state.view);
  annotateRefs(document.querySelector("#view"));
  document.querySelectorAll("[data-go]").forEach((b) => b.addEventListener("click", (e) => { e.preventDefault(); state.view = b.dataset.go; window.scrollTo({ top: 0 }); render(); }));
  document.querySelectorAll("[data-go-glossary]").forEach((b) => b.addEventListener("click", (e) => { e.preventDefault(); if (state.view !== "landscape") { state.view = "landscape"; render(); } const g = document.querySelector("#glossary"); if (g) { g.querySelectorAll("details").forEach((x) => { x.open = true; }); g.scrollIntoView({ block: "start" }); } }));
  const cur = document.querySelector('.rail-item[aria-current="true"]'); if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: "nearest", inline: "center" });
  drawDiagrams(); drawMapEdges();
}
document.querySelector("#home").addEventListener("click", (e) => { e.preventDefault(); state.view = "landscape"; window.scrollTo({ top: 0 }); render(); });
new ResizeObserver(() => drawMapEdges()).observe(document.body);
document.fonts && document.fonts.ready.then(() => drawMapEdges());
render();
</script>
"""


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("model", type=Path)
    parser.add_argument("--out-dir", type=Path, default=Path("docs/domain-viz"))
    parser.add_argument("--write-map", type=Path)
    parser.add_argument("--write-cheatsheet", type=Path)
    parser.add_argument("--html", action="store_true")
    parser.add_argument(
        "--claude-artifact",
        action="store_true",
        help="write claude-artifact.html: an Artifact-ready fragment (no document wrapper) to paste or publish",
    )
    args = parser.parse_args()

    model = load_model(args.model)
    args.out_dir.mkdir(parents=True, exist_ok=True)

    # Stale files from the old one-tab-per-entity-type layout. Their content now lives on
    # the per-context pages; delete them so a regenerated out-dir never carries both.
    for stale in ("building-blocks.md", "lifecycle-map.md", "state-machines.md"):
        stale_path = args.out_dir / stale
        if stale_path.exists():
            stale_path.unlink()

    outputs = {
        "README.md": render_domain_viz_readme(model),
        "context-map.md": render_context_map(model),
        "strategic-map.md": render_strategic_map(model),
        "aggregate-map.md": render_aggregate_map(model),
        "event-flow.md": render_event_flow(model),
        "rule-catalog.md": render_rule_catalog(model),
        "qa.md": render_qa(model),
    }
    # Every D<n> / OQ<n> in prose carries its gist, so a reader never has to look a code up.
    refs = ref_index(model)
    outputs = {name: expand_refs(content, refs) for name, content in outputs.items()}
    for name, content in outputs.items():
        (args.out_dir / name).write_text(content, encoding="utf-8")
    glossary_src = Path(__file__).resolve().parent.parent / "references" / "glossary.md"
    if glossary_src.exists():
        (args.out_dir / "glossary.md").write_text(glossary_src.read_text(encoding="utf-8"), encoding="utf-8")

    contexts_dir = args.out_dir / "contexts"
    contexts_dir.mkdir(parents=True, exist_ok=True)
    context_pages = {name: expand_refs(content, refs) for name, content in render_context_pages(model).items()}
    for name, content in context_pages.items():
        (contexts_dir / name).write_text(content, encoding="utf-8")
    # Drop any context page left over from a context that was removed from the model.
    current_names = set(context_pages)
    for existing in contexts_dir.glob("*.md"):
        if existing.name not in current_names:
            existing.unlink()

    if args.write_map:
        args.write_map.parent.mkdir(parents=True, exist_ok=True)
        args.write_map.write_text(outputs["context-map.md"], encoding="utf-8")
    if args.write_cheatsheet:
        args.write_cheatsheet.parent.mkdir(parents=True, exist_ok=True)
        args.write_cheatsheet.write_text(expand_refs(render_cheatsheet(model), refs), encoding="utf-8")
    if args.html:
        (args.out_dir / "domain-explorer.html").write_text(render_html(model), encoding="utf-8")
    if args.claude_artifact:
        (args.out_dir / "claude-artifact.html").write_text(render_claude_artifact(model), encoding="utf-8")
    artifact_count = len(outputs) + len(context_pages) + (1 if glossary_src.exists() else 0) + (1 if args.html else 0) + (1 if args.claude_artifact else 0)
    print(f"rendered {artifact_count} artifact(s) to {args.out_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
