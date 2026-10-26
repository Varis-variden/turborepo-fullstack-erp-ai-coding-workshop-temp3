/**
 * Narrow helpers for recognising Prisma's known-error codes without importing the generated
 * runtime. Handlers map these to actionable oRPC errors; the raw error (which can carry database
 * detail) never reaches the client (NFR-04).
 */

type PrismaKnownError = { code: string; meta?: { target?: unknown } };

function asPrismaKnownError(error: unknown): PrismaKnownError | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? (error as PrismaKnownError)
    : undefined;
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
  return Array.isArray(target) ? target.includes(field) : target === field;
}
