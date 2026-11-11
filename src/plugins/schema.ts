/** Minimal JSON Schema validation for the public tool boundary. */
export function validateArguments(schema: Record<string, any>, value: unknown, path = 'arguments', depth = 0): void {
  if (depth > 32) throw new Error('Arguments are too deeply nested');
  if (schema.enum && !schema.enum.includes(value)) throw new Error(`${path} must be one of ${schema.enum.join(', ')}`);
  const type = schema.type;
  if (Array.isArray(type)) { if (value === null && type.includes('null')) return; return validateArguments({ ...schema, type: type.find((t: string) => t !== 'null') }, value, path, depth + 1); }
  if (type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${path} must be an object`);
    const object = value as Record<string, unknown>;
    for (const key of schema.required ?? []) if (!(key in object)) throw new Error(`${path}.${key} is required`);
    for (const [key, v] of Object.entries(object)) { if (schema.properties?.[key]) validateArguments(schema.properties[key], v, `${path}.${key}`, depth + 1); else if (schema.additionalProperties === false) throw new Error(`${path}.${key} is unknown`); }
  }
  if (type === 'string' && (typeof value !== 'string' || (schema.maxLength && value.length > schema.maxLength))) throw new Error(`${path} must be a bounded string`);
  if (type === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) throw new Error(`${path} must be a finite number`);
  if (type === 'integer' && (typeof value !== 'number' || !Number.isInteger(value))) throw new Error(`${path} must be an integer`);
  if (type === 'boolean' && typeof value !== 'boolean') throw new Error(`${path} must be boolean`);
  if (type === 'array') { if (!Array.isArray(value)) throw new Error(`${path} must be an array`); for (const v of value) if (schema.items) validateArguments(schema.items, v, path, depth + 1); }
}
