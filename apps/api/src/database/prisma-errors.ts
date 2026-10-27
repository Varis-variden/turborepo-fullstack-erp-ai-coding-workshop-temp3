/**
 * Narrow helpers for recognising Prisma's known-error codes without importing the generated
 * runtime. Handlers map these to actionable oRPC errors; the raw error (which can carry database
 * detail) never reaches the client (NFR-04).
 */

type PrismaKnownError = {
  code: string;
  meta?: {
    /** The classic shape: the field(s) named in the constraint. */
    target?: unknown;
    /**
     * Prisma 7 talks to Postgres through a driver adapter, which reports a unique-constraint
     * violation by the constraint's index name (e.g. `Product_sku_key`) rather than its fields.
     */
    driverAdapterError?: {
      cause?: { constraint?: { index?: unknown; fields?: unknown } };
    };
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
 * must be one of the fields named in the constraint.
 *
 * Two error shapes are accepted. The classic one names the field(s) in `meta.target`. The driver
 * adapter (Prisma 7 + `@prisma/adapter-pg`) instead names the constraint's index, e.g.
 * `Product_sku_key`, from which the field is read by the `<Table>_<field>_key` convention.
 */
export function isUniqueConstraintError(error: unknown, field?: string): boolean {
  const known = asPrismaKnownError(error);
  if (known?.code !== 'P2002') return false;
  if (field === undefined) return true;

  const target = known.meta?.target;
  if (Array.isArray(target) ? target.includes(field) : target === field) return true;

  // Driver-adapter shape: match the field against the constraint it names.
  const constraint = known.meta?.driverAdapterError?.cause?.constraint;
  const fields = constraint?.fields;
  if (Array.isArray(fields) ? fields.includes(field) : fields === field) return true;

  const index = constraint?.index;
  return typeof index === 'string' && indexNamesField(index, field);
}

/** Postgres names a unique index `<Table>_<field>_key`; true when `index` is the one for `field`. */
function indexNamesField(index: string, field: string): boolean {
  return index.endsWith(`_${field}_key`);
}
