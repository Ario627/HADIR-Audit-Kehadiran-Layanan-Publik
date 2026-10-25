import { z } from 'zod';
import { AppError, type FieldError } from '../errors/app-error';

z.config(z.locales.id());

function pathOf(issue: z.ZodIssue): string {
  if (issue.path.length === 0) {
    return '_';
  }
  return issue.path
    .map((segment) => (typeof segment === 'symbol' ? (segment.description ?? 'key') : String(segment)))
    .join('.');
}

function codeOf(issue: z.ZodIssue): string {
  switch (issue.code) {
    case 'too_small':
      if (issue.origin === 'string') return 'too_short';
      if (issue.origin === 'array') return 'too_few';
      return 'too_small';
    case 'too_big':
      if (issue.origin === 'string') return 'too_long';
      if (issue.origin === 'array') return 'too_many';
      return 'too_big';
    case 'invalid_format':
      return 'invalid_format';
    case 'invalid_type':
      return 'invalid_type';
    case 'invalid_value':
      return 'invalid_value';
    case 'not_multiple_of':
      return 'invalid_multiple';
    case 'unrecognized_keys':
      return 'unknown_field';
    case 'invalid_union':
      return 'invalid_union';
    default:
      return 'invalid';
  }
}

function expandIssue(issue: z.ZodIssue): FieldError[] {
  if (issue.code === 'unrecognized_keys') {
    return issue.keys.map((key) => ({
      field: issue.path.length > 0 ? `${pathOf(issue)}.${key}` : key,
      code: 'unknown_field',
      message: `Field ${key} tidak dikenal.`,
    }));
  }
  return [{ field: pathOf(issue), code: codeOf(issue), message: issue.message }];
}

export function fieldErrorsFromZod(error: z.ZodError): FieldError[] {
  return error.issues.flatMap(expandIssue);
}

export function parseOrThrow<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new AppError('VALIDATION_FAILED', {
      detail: 'Satu atau lebih field tidak valid.',
      errors: fieldErrorsFromZod(result.error),
    });
  }
  return result.data;
}
