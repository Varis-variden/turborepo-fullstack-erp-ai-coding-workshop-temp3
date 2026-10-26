import { ORPCError } from '@orpc/nest';

/** The Thai message shown for any unexpected server error (NFR-04). */
export const GENERIC_SERVER_ERROR_MESSAGE = 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่อีกครั้งในภายหลัง';

/**
 * Shape an error for the client so NFR-04 holds: actionable messages, never a stack trace or
 * database detail.
 *
 * An `ORPCError` is a deliberate, already-safe failure a handler raised (its message is the Thai
 * copy we chose), so it passes through untouched. Anything else — a thrown `Error`, a Prisma
 * failure, a bug — is replaced by a generic Thai `INTERNAL_SERVER_ERROR` that carries none of the
 * original message, stack, or metadata.
 */
export function sanitizeError(error: unknown): ORPCError<string, unknown> {
  if (error instanceof ORPCError) return error;
  return new ORPCError('INTERNAL_SERVER_ERROR', { message: GENERIC_SERVER_ERROR_MESSAGE });
}
