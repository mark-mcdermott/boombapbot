/** Keys that hold a row id, or something built from one. */
const ROW_ID_KEYS = new Set(['id', 'userId', 'accountId']);

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype;
}

/**
 * A copy of an API answer with every row id taken out. A record that has a
 * `uuid` is given it as its `id`; one that does not simply loses the id. The
 * same value comes back when there was nothing to change.
 */
export function withPublicIds(value: unknown): unknown {
  if (Array.isArray(value)) {
    const items = value.map(withPublicIds);
    return items.some((item, index) => item !== value[index]) ? items : value;
  }
  if (!isRecord(value)) return value;

  const { uuid, ...fields } = value;
  let changed = typeof uuid === 'string';
  const shaped: Record<string, unknown> = changed ? { id: uuid } : {};
  for (const [key, field] of Object.entries(fields)) {
    if (ROW_ID_KEYS.has(key)) {
      changed = true;
      continue;
    }
    shaped[key] = withPublicIds(field);
    changed ||= shaped[key] !== field;
  }
  return changed ? shaped : value;
}
