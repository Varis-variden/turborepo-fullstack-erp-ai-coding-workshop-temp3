/**
 * Narrow helpers for recognising Prisma's known-error codes without importing the generated
 * runtime. Handlers map these to actionable oRPC errors; the raw error (which can carry database
 * detail) never reaches the client (NFR-04).
 */

type PrismaKnownError = {
  code: string;
  meta?: {
    target?: unknown;
    /** What the `pg` driver adapter reports instead of `target`. */
    driverAdapterError?: { cause?: { constraint?: { fields?: unknown; index?: unknown } } };
  };
};

function asPrismaKnownError(error: unknown): PrismaKnownError | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? (error as PrismaKnownError)
    : undefined;
}

/** True when `error` is Prisma's "record to update or delete does not exist" (`P2025`). */
export function isRecordNotFoundError(error: unknown): boolean {
  return asPrismaKnownError(error)?.code === 'P2025';
}

/**
 * True when `error` is a unique-constraint violation (Prisma `P2002`). When `field` is given, it
 * must be one of the fields named in the constraint target.
 */
export function isUniqueConstraintError(error: unknown, field?: string): boolean {
  const known = asPrismaKnownError(error);
  if (known?.code !== 'P2002') return false;
  if (field === undefined) return true;

  const target = known.meta?.target;
  if (target !== undefined)
    return Array.isArray(target) ? target.includes(field) : target === field;

  // Through the driver adapter the constraint is named by its fields or, for a unique index, by
  // its name: `<Model>_<field>_key`.
  const constraint = known.meta?.driverAdapterError?.cause?.constraint;
  if (Array.isArray(constraint?.fields)) return constraint.fields.includes(field);
  return typeof constraint?.index === 'string' && constraint.index.endsWith(`_${field}_key`);
}
