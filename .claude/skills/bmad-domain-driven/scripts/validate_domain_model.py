#!/usr/bin/env python3
"""Validate the semantic invariants of a BMAD domain-model.json file."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any


ALLOWED_STATUS = {"observed", "target", "proposed", "unknown"}
RELATION_KINDS = {"PORT", "EVENT", "REFERENCE", "SHARED_KERNEL", "EXTERNAL"}
DOMAIN_TYPES = {"core", "supporting", "generic", "unknown"}
CONTEXT_PATTERNS = {
    "upstream-downstream",
    "customer-supplier",
    "partnership",
    "conformist",
    "anti-corruption-layer",
    "open-host-service",
    "published-language",
    "shared-kernel",
    "separate-ways",
}
BUILDING_BLOCK_KINDS = {
    "aggregate-root",
    "entity",
    "value-object",
    "domain-primitive",
    "domain-service",
    "repository",
    "factory",
    "specification",
    "policy",
    "domain-event",
    "command",
    "port",
    "adapter",
    "anti-corruption-layer",
    "read-model",
    "shared-kernel",
    "process-manager",
}
RULE_KINDS = {"invariant", "policy", "authorization", "uniqueness", "workflow", "specification", "unknown"}

SCHEMA_PATH = Path(__file__).resolve().parent.parent / "references" / "domain-model.schema.json"


def fail(errors: list[str], message: str) -> None:
    errors.append(message)


def check_id(value: Any, path: str, errors: list[str]) -> None:
    if not isinstance(value, str) or not value or value != value.lower():
        fail(errors, f"{path} must be a non-empty lowercase id")


def check_status(obj: dict[str, Any], path: str, errors: list[str]) -> None:
    status = obj.get("status")
    if status is not None and status not in ALLOWED_STATUS:
        fail(errors, f"{path}.status must be one of {sorted(ALLOWED_STATUS)}")


def check_enum(value: Any, allowed: set[str], path: str, errors: list[str]) -> None:
    if value is not None and value not in allowed:
        fail(errors, f"{path} must be one of {sorted(allowed)}")


def unique(values: list[str], path: str, errors: list[str]) -> None:
    seen: set[str] = set()
    for value in values:
        if value in seen:
            fail(errors, f"{path} contains duplicate id {value!r}")
        seen.add(value)


def run_schema_validation(model: dict[str, Any], errors: list[str]) -> bool:
    """Validate `model` structurally against references/domain-model.schema.json.

    Returns True if the JSON Schema check actually ran. If the `jsonschema`
    package is not importable, this is reported honestly on stderr and the
    caller's semantic checks still run; we never claim full coverage we did
    not perform.
    """
    try:
        import jsonschema
    except ImportError:
        print(
            "warning: `jsonschema` is not installed, so JSON Schema structural "
            "validation was SKIPPED (pip install jsonschema to enable it). "
            "Semantic checks below still ran.",
            file=sys.stderr,
        )
        return False

    try:
        schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        fail(errors, f"schema: cannot read {SCHEMA_PATH}: {exc}")
        return True

    validator_cls = jsonschema.validators.validator_for(schema)
    validator_cls.check_schema(schema)
    validator = validator_cls(schema)
    schema_errors = sorted(validator.iter_errors(model), key=lambda exc: list(exc.path))
    for exc in schema_errors:
        location = "/".join(str(part) for part in exc.path) or "<root>"
        fail(errors, f"schema: {location}: {exc.message}")
    return True


def field_paths(fields: list[dict[str, Any]], prefix: str = "") -> list[str]:
    paths: list[str] = []
    for field in fields:
        name = str(field.get("name", ""))
        path = f"{prefix}{name}"
        paths.append(path)
        paths.extend(field_paths(field.get("fields", []), path + "."))
    return paths


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: validate_domain_model.py DOMAIN_MODEL_JSON", file=sys.stderr)
        return 2

    source = Path(sys.argv[1])
    errors: list[str] = []
    warnings: list[str] = []
    try:
        model = json.loads(source.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        print(f"error: cannot read {source}: {exc}", file=sys.stderr)
        return 2

    if not isinstance(model, dict):
        print("error: root must be a JSON object", file=sys.stderr)
        return 2

    ran_schema_validation = run_schema_validation(model, errors)

    contexts = model.get("contexts", [])
    if not isinstance(contexts, list):
        fail(errors, "contexts must be an array")
        contexts = []
    context_ids = [ctx.get("id") for ctx in contexts if isinstance(ctx, dict)]
    unique([value for value in context_ids if isinstance(value, str)], "contexts", errors)
    context_map = {ctx.get("id"): ctx for ctx in contexts if isinstance(ctx, dict)}
    aggregate_map: dict[str, tuple[str, dict[str, Any]]] = {}
    event_ids: set[str] = set()
    use_case_ids: set[str] = set()
    rule_ids: set[str] = set()
    building_block_map: dict[str, dict[str, Any]] = {}
    pending_event_refs: list[tuple[str, str]] = []
    pending_use_case_refs: list[tuple[str, str]] = []

    strategic_model = model.get("strategicModel")
    if not isinstance(strategic_model, dict):
        warnings.append("strategicModel is missing; core/supporting/generic classification cannot be reviewed")
    else:
        for subdomain_index, subdomain in enumerate(strategic_model.get("subdomains", [])):
            subdomain_path = f"strategicModel.subdomains[{subdomain_index}]"
            if isinstance(subdomain, dict):
                check_id(subdomain.get("id"), f"{subdomain_path}.id", errors)
                check_enum(subdomain.get("domainType"), DOMAIN_TYPES, f"{subdomain_path}.domainType", errors)
                for context_id_ref in subdomain.get("contextIds", []) or []:
                    if context_id_ref not in context_map:
                        fail(
                            errors,
                            f"{subdomain_path}.contextIds references unknown context {context_id_ref!r}",
                        )

    for index, context in enumerate(contexts):
        path = f"contexts[{index}]"
        if not isinstance(context, dict):
            fail(errors, f"{path} must be an object")
            continue
        check_id(context.get("id"), f"{path}.id", errors)
        check_status(context, path, errors)
        check_enum(context.get("domainType"), DOMAIN_TYPES, f"{path}.domainType", errors)
        if not context.get("domainType"):
            warnings.append(f"{path} has no domainType (core/supporting/generic)")
        aggregates = context.get("aggregates", [])
        if not isinstance(aggregates, list):
            fail(errors, f"{path}.aggregates must be an array")
            aggregates = []
        aggregate_ids = []
        for aggregate_index, aggregate in enumerate(aggregates):
            aggregate_path = f"{path}.aggregates[{aggregate_index}]"
            if not isinstance(aggregate, dict):
                fail(errors, f"{aggregate_path} must be an object")
                continue
            aggregate_id = aggregate.get("id")
            aggregate_ids.append(aggregate_id)
            check_id(aggregate_id, f"{aggregate_path}.id", errors)
            check_status(aggregate, aggregate_path, errors)
            check_enum(aggregate.get("domainRole"), DOMAIN_TYPES, f"{aggregate_path}.domainRole", errors)
            if not aggregate.get("domainRole"):
                warnings.append(f"{aggregate_path} has no domainRole")
            if not aggregate.get("aggregateRoot"):
                warnings.append(f"{aggregate_path} has no aggregateRoot; verify whether this is an aggregate or entity")
            if not aggregate.get("consistencyBoundary"):
                warnings.append(f"{aggregate_path} has no consistencyBoundary")
            if isinstance(aggregate_id, str):
                if aggregate_id in aggregate_map:
                    fail(errors, f"aggregate id {aggregate_id!r} is not globally unique")
                aggregate_map[aggregate_id] = (str(context.get("id")), aggregate)
            paths = field_paths(aggregate.get("fields", []))
            unique(paths, f"{aggregate_path}.fields", errors)
            lifecycle = aggregate.get("lifecycle")
            if lifecycle:
                check_enum(
                    lifecycle.get("kind"),
                    {"state-machine", "lifecycle", "workflow", "unknown"},
                    f"{aggregate_path}.lifecycle.kind",
                    errors,
                )
                state_names = [state.get("name") for state in lifecycle.get("states", [])]
                state_set = {name for name in state_names if isinstance(name, str)}
                initial = lifecycle.get("initial")
                if initial not in state_set:
                    fail(errors, f"{aggregate_path}.lifecycle.initial {initial!r} is not declared")
                for transition_index, transition in enumerate(lifecycle.get("transitions", [])):
                    transition_path = f"{aggregate_path}.lifecycle.transitions[{transition_index}]"
                    if transition.get("from") not in state_set:
                        fail(errors, f"{transition_path}.from is not a declared state")
                    if transition.get("to") not in state_set:
                        fail(errors, f"{transition_path}.to is not a declared state")
                    if not transition.get("guards"):
                        warnings.append(f"{transition_path} has no guards; confirm the transition is domain-authorized")
                    for emitted_id in transition.get("emits", []) or []:
                        if isinstance(emitted_id, str):
                            pending_event_refs.append((f"{transition_path}.emits", emitted_id))
            for rule_index, rule in enumerate(aggregate.get("rules", [])):
                rule_path = f"{aggregate_path}.rules[{rule_index}]"
                if not isinstance(rule, dict):
                    fail(errors, f"{rule_path} must be an object")
                    continue
                rule_id = rule.get("id")
                check_id(rule_id, f"{rule_path}.id", errors)
                if isinstance(rule_id, str):
                    if rule_id in rule_ids:
                        fail(errors, f"rule id {rule_id!r} is not globally unique")
                    rule_ids.add(rule_id)
                check_enum(rule.get("kind"), RULE_KINDS, f"{rule_path}.kind", errors)
                check_status(rule, rule_path, errors)
            for event_id_ref in aggregate.get("events", []) or []:
                if isinstance(event_id_ref, str):
                    pending_event_refs.append((f"{aggregate_path}.events", event_id_ref))
            for use_case_id_ref in aggregate.get("useCases", []) or []:
                if isinstance(use_case_id_ref, str):
                    pending_use_case_refs.append((f"{aggregate_path}.useCases", use_case_id_ref))
        unique([value for value in aggregate_ids if isinstance(value, str)], f"{path}.aggregates", errors)

        for event_index, event in enumerate(context.get("events", [])):
            event_path = f"{path}.events[{event_index}]"
            if not isinstance(event, dict):
                fail(errors, f"{event_path} must be an object")
                continue
            event_id = event.get("id")
            check_id(event_id, f"{event_path}.id", errors)
            if isinstance(event_id, str):
                if event_id in event_ids:
                    fail(errors, f"event id {event_id!r} is not globally unique")
                event_ids.add(event_id)
            check_status(event, event_path, errors)

        for use_case_index, use_case in enumerate(context.get("useCases", [])):
            use_case_path = f"{path}.useCases[{use_case_index}]"
            if not isinstance(use_case, dict):
                fail(errors, f"{use_case_path} must be an object")
                continue
            use_case_id = use_case.get("id")
            check_id(use_case_id, f"{use_case_path}.id", errors)
            if isinstance(use_case_id, str):
                if use_case_id in use_case_ids:
                    fail(errors, f"use case id {use_case_id!r} is not globally unique")
                use_case_ids.add(use_case_id)

        for rule_index, rule in enumerate(context.get("rules", [])):
            rule_path = f"{path}.rules[{rule_index}]"
            if not isinstance(rule, dict):
                fail(errors, f"{rule_path} must be an object")
                continue
            rule_id = rule.get("id")
            check_id(rule_id, f"{rule_path}.id", errors)
            if isinstance(rule_id, str):
                if rule_id in rule_ids:
                    fail(errors, f"rule id {rule_id!r} is not globally unique")
                rule_ids.add(rule_id)
            check_enum(rule.get("kind"), RULE_KINDS, f"{rule_path}.kind", errors)
            check_status(rule, rule_path, errors)

    for ref_path, event_id_ref in pending_event_refs:
        if event_id_ref not in event_ids:
            fail(errors, f"{ref_path} references unknown event {event_id_ref!r}")
    for ref_path, use_case_id_ref in pending_use_case_refs:
        if use_case_id_ref not in use_case_ids:
            fail(errors, f"{ref_path} references unknown use case {use_case_id_ref!r}")

    building_blocks = model.get("buildingBlocks", [])
    if not isinstance(building_blocks, list):
        fail(errors, "buildingBlocks must be an array")
        building_blocks = []
    for index, block in enumerate(building_blocks):
        path = f"buildingBlocks[{index}]"
        if not isinstance(block, dict):
            fail(errors, f"{path} must be an object")
            continue
        block_id = block.get("id")
        check_id(block_id, f"{path}.id", errors)
        if isinstance(block_id, str):
            if block_id in building_block_map:
                fail(errors, f"building block id {block_id!r} is not globally unique")
            building_block_map[block_id] = block
        check_enum(block.get("kind"), BUILDING_BLOCK_KINDS, f"{path}.kind", errors)
        context_id = block.get("context")
        if context_id and context_id not in context_map:
            fail(errors, f"{path}.context references unknown context {context_id!r}")
        aggregate_id = block.get("aggregate")
        if aggregate_id and aggregate_id not in aggregate_map:
            fail(errors, f"{path}.aggregate references unknown aggregate {aggregate_id!r}")

    for context_id, context in context_map.items():
        for aggregate in context.get("aggregates", []):
            for block_id in aggregate.get("buildingBlockIds", []):
                if block_id not in building_block_map:
                    fail(
                        errors,
                        f"aggregate {aggregate.get('id')!r} references unknown building block {block_id!r}",
                    )

    relations = model.get("relations", [])
    if not isinstance(relations, list):
        fail(errors, "relations must be an array")
        relations = []
    for index, relation in enumerate(relations):
        path = f"relations[{index}]"
        if not isinstance(relation, dict):
            fail(errors, f"{path} must be an object")
            continue
        source_id = relation.get("from")
        target_id = relation.get("to")
        if source_id not in context_map:
            fail(errors, f"{path}.from references unknown context {source_id!r}")
        if target_id not in context_map and target_id not in {"external", "shared-kernel"}:
            fail(errors, f"{path}.to references unknown context {target_id!r}")
        if relation.get("kind") not in RELATION_KINDS:
            fail(errors, f"{path}.kind must be one of {sorted(RELATION_KINDS)}")
        check_enum(relation.get("pattern"), CONTEXT_PATTERNS, f"{path}.pattern", errors)
        if relation.get("kind") in {"PORT", "EVENT", "REFERENCE"} and not relation.get("pattern"):
            warnings.append(f"{path} has no context-map pattern")
        for key in ("fromAggregate", "toAggregate"):
            aggregate_id = relation.get(key)
            if aggregate_id and aggregate_id not in aggregate_map:
                fail(errors, f"{path}.{key} references unknown aggregate {aggregate_id!r}")
        check_status(relation, path, errors)

    if errors:
        print(f"{source}: {len(errors)} error(s), {len(warnings)} warning(s)", file=sys.stderr)
        print(
            "structural (JSON Schema): "
            + ("checked" if ran_schema_validation else "SKIPPED (jsonschema not installed)"),
            file=sys.stderr,
        )
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        for warning in warnings:
            print(f"warning: {warning}", file=sys.stderr)
        return 1

    print(
        f"valid: {source} ({len(context_map)} contexts, {len(aggregate_map)} aggregates, "
        f"{len(building_block_map)} building blocks, {len(relations)} relations, {len(rule_ids)} rules)"
    )
    print(
        "structural (JSON Schema): "
        + ("checked" if ran_schema_validation else "SKIPPED (jsonschema not installed)")
    )
    if warnings:
        print(f"warnings: {len(warnings)}")
        for warning in warnings:
            print(f"- {warning}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
