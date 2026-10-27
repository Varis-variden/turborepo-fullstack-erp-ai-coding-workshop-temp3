import type { ReceivingOrder } from '@erp/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { orpc } from '@/lib/orpc';

const FALLBACK_ERROR = 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง';

const STATUS_LABEL: Record<ReceivingOrder['status'], string> = {
  DRAFT: 'ฉบับร่าง',
  APPROVED: 'อนุมัติแล้ว',
  PARTIALLY_RECEIVED: 'รับสินค้าบางส่วน',
  COMPLETED: 'รับสินค้าครบแล้ว',
};

/** The messages of the contract's validation issues, when the API rejected the input. */
function validationMessages(error: unknown): string[] {
  const data = (error as { data?: { issues?: { message?: unknown }[] } } | null)?.data;
  return (data?.issues ?? [])
    .map((issue) => issue.message)
    .filter((message): message is string => typeof message === 'string' && message.length > 0);
}

/** The actionable Thai copy for an error: what to fix if the input was invalid, else the API's message. */
function errorMessage(error: unknown): string {
  const issues = validationMessages(error);
  if (issues.length > 0) return issues.join(' · ');
  return error instanceof Error && error.message ? error.message : FALLBACK_ERROR;
}

/** An empty box means nothing delivered for that line. */
function toQuantity(value: string | undefined): number {
  return value === undefined || value.trim() === '' ? 0 : Number(value);
}

function ReceivingOrderCard({ order }: { order: ReceivingOrder }) {
  const queryClient = useQueryClient();
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  // One key per user action: a retry of the same action reuses it, so the server can never post
  // it twice; it is replaced only once the receipt is confirmed, so the next receipt is new.
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [confirmedNumber, setConfirmedNumber] = useState<string | null>(null);

  const confirm = useMutation(
    orpc.goodsReceipts.confirm.mutationOptions({
      onSuccess: (receipt) => {
        setConfirmedNumber(receipt.number);
        setQuantities({});
        setIdempotencyKey(crypto.randomUUID());
      },
      onSettled: () =>
        Promise.all([
          queryClient.invalidateQueries({ queryKey: orpc.goodsReceipts.key() }),
          queryClient.invalidateQueries({ queryKey: orpc.inventory.key() }),
        ]),
    }),
  );

  return (
    <section aria-label={order.number} className="space-y-3 rounded-md border p-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-mono text-lg font-semibold">{order.number}</h2>
        <Badge variant="secondary">{STATUS_LABEL[order.status]}</Badge>
        <span className="text-sm text-muted-foreground">
          {order.supplierName} · สาขา {order.storeName} · คาดว่าจะได้รับ {order.expectedReceiptDate}
        </span>
      </div>
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          setConfirmedNumber(null);
          confirm.mutate({
            purchaseOrderNumber: order.number,
            idempotencyKey,
            lines: order.lines.map((line) => ({
              sku: line.sku,
              quantity: toQuantity(quantities[line.sku]),
            })),
          });
        }}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-muted/50">
              <tr>
                <th className="px-3 py-2 font-medium">รหัสสินค้า (SKU)</th>
                <th className="px-3 py-2 font-medium">ชื่อสินค้า</th>
                <th className="px-3 py-2 font-medium">หน่วยนับ</th>
                <th className="px-3 py-2 text-right font-medium">จำนวนที่สั่ง</th>
                <th className="px-3 py-2 text-right font-medium">รับแล้ว</th>
                <th className="px-3 py-2 text-right font-medium">คงค้าง</th>
                <th className="px-3 py-2 text-right font-medium">รับครั้งนี้</th>
              </tr>
            </thead>
            <tbody>
              {order.lines.map((line) => (
                <tr key={line.id} className="border-b last:border-0">
                  <td className="px-3 py-2 font-mono text-muted-foreground">{line.sku}</td>
                  <td className="px-3 py-2">{line.name}</td>
                  <td className="px-3 py-2">{line.unit}</td>
                  <td className="px-3 py-2 text-right">{line.ordered}</td>
                  <td className="px-3 py-2 text-right">{line.received}</td>
                  <td className="px-3 py-2 text-right">{line.outstanding}</td>
                  <td className="px-3 py-2 text-right">
                    <Input
                      aria-label={`จำนวนที่รับครั้งนี้ ${line.sku}`}
                      className="ml-auto w-24 text-right"
                      inputMode="numeric"
                      value={quantities[line.sku] ?? ''}
                      onChange={(event) =>
                        setQuantities((current) => ({ ...current, [line.sku]: event.target.value }))
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <Button type="submit" disabled={confirm.isPending}>
            {confirm.isPending ? 'กำลังบันทึก…' : 'ยืนยันการรับสินค้า'}
          </Button>
          {confirmedNumber && (
            <p role="status" className="text-sm text-muted-foreground">
              บันทึกใบรับสินค้า {confirmedNumber} สำเร็จ
            </p>
          )}
          {confirm.isError && (
            <p role="alert" className="text-sm text-destructive">
              {errorMessage(confirm.error)}
            </p>
          )}
        </div>
      </form>
    </section>
  );
}

function ReceivableOrders() {
  const orders = useQuery(
    orpc.goodsReceipts.listOrders.queryOptions({ input: { page: 1, pageSize: 20 } }),
  );

  if (orders.isPending) return <p className="text-muted-foreground">กำลังโหลด…</p>;
  if (orders.isError) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {errorMessage(orders.error)}
      </p>
    );
  }
  if (orders.data.items.length === 0) {
    return <p className="text-muted-foreground">ไม่มีใบสั่งซื้อที่รอรับสินค้า</p>;
  }

  return (
    <div className="space-y-4">
      {orders.data.items.map((order) => (
        <ReceivingOrderCard key={order.id} order={order} />
      ))}
    </div>
  );
}

export function GoodsReceiptsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">รับสินค้า</h1>
        <p className="text-muted-foreground">
          รับสินค้าตามใบสั่งซื้อที่อนุมัติแล้วของสาขาคุณ ระบุจำนวนที่รับในแต่ละครั้ง
          ระบบจะสร้างเลขที่ใบรับสินค้าและเพิ่มสต็อกให้
        </p>
      </div>
      <ReceivableOrders />
    </div>
  );
}
