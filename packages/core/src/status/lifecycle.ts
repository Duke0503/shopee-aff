/**
 * Reading the registry: sort by lifecycle (never alphabetically), check a transition,
 * list the values a column may store. Nothing else keeps its own copy of these rules.
 */
import { STATUS_REGISTRY, type EntityName, type StatusDefinition, type StatusOf } from "./registry";

export function statusesOf<E extends EntityName>(entity: E): readonly StatusDefinition<StatusOf<E>>[] {
  return STATUS_REGISTRY[entity].statuses as readonly StatusDefinition<StatusOf<E>>[];
}

export function statusDefinition<E extends EntityName>(entity: E, value: StatusOf<E>): StatusDefinition<StatusOf<E>> {
  const found = statusesOf(entity).find((s) => s.value === value);
  if (!found) throw new RangeError(`unknown ${entity} status: ${String(value)}`);
  return found;
}

/** Compares two statuses by lifecycle order, for `Array.prototype.sort`. */
export function compareByLifecycle<E extends EntityName>(entity: E): (a: StatusOf<E>, b: StatusOf<E>) => number {
  return (a, b) => statusDefinition(entity, a).order - statusDefinition(entity, b).order;
}

export function sortByLifecycle<E extends EntityName>(entity: E, values: readonly StatusOf<E>[]): StatusOf<E>[] {
  return [...values].sort(compareByLifecycle(entity));
}

export function canTransition<E extends EntityName>(entity: E, from: StatusOf<E>, to: StatusOf<E>): boolean {
  const transitions = STATUS_REGISTRY[entity].transitions as readonly (readonly [string, string])[];
  return transitions.some(([f, t]) => f === from && t === to);
}

/** The values a status column may hold; derived timed states are left out. */
export function storedValues<E extends EntityName>(entity: E): StatusOf<E>[] {
  return statusesOf(entity)
    .filter((s) => s.derivedFrom === null)
    .map((s) => s.value);
}

/** Every label and message key the registry points at, for the resource check. */
export function registryKeys(): { labelKeys: string[]; messageKeys: string[] } {
  const all = Object.values(STATUS_REGISTRY).flatMap((e) => e.statuses as readonly StatusDefinition[]);
  return {
    labelKeys: all.map((s) => s.labelKey),
    messageKeys: all.flatMap((s) => (s.messageKey === null ? [] : [s.messageKey])),
  };
}
