import { z, type ZodType } from 'zod';
import { OBJECT_ID_PATTERN } from '../utils/validators.js';

/** The subset of JSON Schema that z.toJSONSchema() produces for our DTOs. */
export interface JsonSchema {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean | JsonSchema;
  items?: JsonSchema;
  enum?: unknown[];
  const?: unknown;
  default?: unknown;
  example?: unknown;
  examples?: unknown[];
  description?: string;
  format?: string;
  pattern?: string;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  allOf?: JsonSchema[];
}

/** Request-side JSON Schema (before transforms, so defaults are optional inputs). */
export const toJsonSchema = (schema: ZodType): JsonSchema =>
  z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as JsonSchema;

const FIXED_DATE = '2026-04-01T00:00:00.000Z';

const isObjectIdSchema = (schema: JsonSchema): boolean => schema.pattern === OBJECT_ID_PATTERN.source;

const firstVariant = (schema: JsonSchema): JsonSchema | undefined =>
  [...(schema.anyOf ?? []), ...(schema.oneOf ?? [])].find((v) => v.type !== 'null');

const stringExample = (schema: JsonSchema, key: string): string => {
  if (schema.format === 'email') return 'user@example.com';
  if (schema.format === 'date-time') return FIXED_DATE;
  if (schema.format === 'date') return FIXED_DATE.slice(0, 10);
  if (schema.format === 'uri' || schema.format === 'url') return 'https://example.com';
  // Ids become Postman variables ({{centreId}}), filled in by earlier "create" requests. A field
  // named after the entity (`centre`, `experiment`) uses the same variable as `centreId`.
  if (isObjectIdSchema(schema)) {
    if (!key) return '000000000000000000000000';
    return `{{${key.endsWith('Id') ? key : `${key}Id`}}}`;
  }
  if (/password/i.test(key)) return 'ChangeMe12345';

  let text = key ? `Sample ${key}` : 'Sample text';
  if (schema.minLength && text.length < schema.minLength) text = text.padEnd(schema.minLength, 'x');
  if (schema.maxLength && text.length > schema.maxLength) text = text.slice(0, schema.maxLength);
  return text;
};

/**
 * Builds an example value from a JSON Schema. Priority: an explicit `.meta({ example })` on the
 * Zod field, then its default, then the first enum value, then a type-based guess.
 * If a guess wouldn't pass the field's rules (e.g. a regex), add `.meta({ example })` to the DTO:
 * tests/postman.test.ts checks every generated body against its own schema.
 */
export const exampleFor = (schema: JsonSchema, key = ''): unknown => {
  if (schema.example !== undefined) return schema.example;
  if (schema.examples?.length) return schema.examples[0];
  if (schema.const !== undefined) return schema.const;
  if (schema.default !== undefined && schema.default !== null) return schema.default;
  if (schema.enum?.length) return schema.enum[0];

  const variant = firstVariant(schema);
  if (variant) return exampleFor(variant, key);

  const type = Array.isArray(schema.type) ? schema.type.find((t) => t !== 'null') : schema.type;
  switch (type) {
    case 'object':
      return Object.fromEntries(
        Object.entries(schema.properties ?? {}).map(([name, prop]) => [name, exampleFor(prop, name)]),
      );
    case 'array':
      // An array of ids (centreIds) gets the singular variable ({{centreId}}).
      return schema.items ? [exampleFor(schema.items, key.replace(/Ids$/, 'Id'))] : [];
    case 'integer':
    case 'number':
      return schema.minimum ?? 1;
    case 'boolean':
      return true;
    case 'null':
      return null;
    case 'string':
      return stringExample(schema, key);
    default:
      return null;
  }
};

/** One-line rules for a field, for the docs table: "2–120 chars", "pattern ^[A-Z]+$", "default 20". */
export const describeRules = (schema: JsonSchema): string => {
  const target = firstVariant(schema) ?? schema;
  const rules: string[] = [];
  if (target.enum) rules.push(`one of ${target.enum.map((v) => `\`${String(v)}\``).join(', ')}`);
  if (target.format) rules.push(target.format);
  if (target.minLength !== undefined || target.maxLength !== undefined) {
    rules.push(`${target.minLength ?? 0}–${target.maxLength ?? '∞'} chars`);
  }
  if (target.minimum !== undefined && target.minimum > -Number.MAX_SAFE_INTEGER) {
    rules.push(`min ${target.minimum}`);
  }
  if (target.maximum !== undefined && target.maximum < Number.MAX_SAFE_INTEGER) {
    rules.push(`max ${target.maximum}`);
  }
  if (isObjectIdSchema(target)) rules.push('ObjectId');
  else if (target.pattern) rules.push(`pattern \`${target.pattern}\``);
  if (schema.default !== undefined) rules.push(`default \`${JSON.stringify(schema.default)}\``);
  if (schema.anyOf?.some((v) => v.type === 'null')) rules.push('nullable');
  return rules.join('; ');
};

export const typeLabel = (schema: JsonSchema): string => {
  const target = firstVariant(schema) ?? schema;
  const type = Array.isArray(target.type) ? target.type.join(' | ') : (target.type ?? 'any');
  return type === 'array' && target.items ? `${typeLabel(target.items)}[]` : type;
};
