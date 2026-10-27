import type { Prisma } from '@erp/database';

/** The numbered document types. Each has its own sequence and prefix (`PO-001`, later `GR-`, `SAL-`). */
export type DocumentType = 'PO';

/** Numbers are zero-padded to this many digits; a longer sequence value simply keeps its digits. */
const DOCUMENT_NUMBER_WIDTH = 3;

export function formatDocumentNumber(type: DocumentType, value: number): string {
  return `${type}-${String(value).padStart(DOCUMENT_NUMBER_WIDTH, '0')}`;
}

/**
 * Allocate the next number for `type`. Call it on the transaction client, in the same transaction
 * that creates the document: the row lock taken by the increment serialises concurrent creates,
 * so they can never be given the same number, and a rolled-back create gives its number back.
 * The document's own `number` column is unique-constrained as the last line of defence.
 *
 * The number comes from the counter, never from parsing existing numbers, so documents with other
 * formats (such as the demo `PO-DEMO-001`) do not disturb it.
 */
export async function allocateDocumentNumber(
  tx: Pick<Prisma.TransactionClient, 'documentSequence'>,
  type: DocumentType,
): Promise<string> {
  const sequence = await tx.documentSequence.upsert({
    where: { type },
    create: { type, lastValue: 1 },
    update: { lastValue: { increment: 1 } },
  });
  return formatDocumentNumber(type, sequence.lastValue);
}
