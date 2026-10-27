import type { AuditEntry, StockAdjustmentResult } from '@erp/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { orpc } from '@/lib/orpc';

const FALLBACK_ERROR = 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง';

/** The messages of the contract's validation issues, when the API rejected the input. */
function validationMessages(error: unknown): string[] {
  const data = (error as { data?: { issues?: { message?: unknown }[] } } | null)?.data;
  return (data?.issues ?? [])
    .map((issue) => issue.message)
    .filter((message): message is string => typeof message === 'string' && message.length > 0);
}

function errorMessage(error: unknown): string {
  const issues = validationMessages(error);
  if (issues.length > 0) return issues.join(' · ');
  return error instanceof Error && error.message ? error.message : FALLBACK_ERROR;
}

const OUTCOME_LABEL: Record<AuditEntry['outcome'], string> = {
  POSTED: 'สำเร็จ',
  REJECTED: 'ถูกปฏิเสธ',
};

function AuditRow({ entry }: { entry: AuditEntry }) {
  return (
    <tr className="border-b last:border-0">
      <td className="px-4 py-3 text-sm text-muted-foreground">
        {new Date(entry.createdAt).toLocaleString('th-TH')}
      </td>
      <td className="px-4 py-3">{entry.storeCode}</td>
      <td className="px-4 py-3">{entry.actorName}</td>
      <td className="px-4 py-3">
        <Badge variant={entry.outcome === 'POSTED' ? 'default' : 'destructive'}>
          {OUTCOME_LABEL[entry.outcome]}
        </Badge>
      </td>
      <td className="px-4 py-3">{entry.detail ?? '—'}</td>
    </tr>
  );
}

function AuditLog() {
  const audit = useQuery(orpc.audit.list.queryOptions({ input: { page: 1, pageSize: 20 } }));

  if (audit.isPending) return <p className="text-muted-foreground">กำลังโหลด…</p>;
  if (audit.isError) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {errorMessage(audit.error)}
      </p>
    );
  }
  if (audit.data.items.length === 0) {
    return <p className="text-muted-foreground">ยังไม่มีรายการในบันทึกการตรวจสอบ</p>;
  }

  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-left">
        <thead className="border-b bg-muted/50 text-sm">
          <tr>
            <th className="px-4 py-2 font-medium">เวลา</th>
            <th className="px-4 py-2 font-medium">สาขา</th>
            <th className="px-4 py-2 font-medium">ผู้ดำเนินการ</th>
            <th className="px-4 py-2 font-medium">ผลลัพธ์</th>
            <th className="px-4 py-2 font-medium">เหตุผล</th>
          </tr>
        </thead>
        <tbody>
          {audit.data.items.map((entry) => (
            <AuditRow key={entry.id} entry={entry} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AdjustStockForm() {
  const queryClient = useQueryClient();
  const stores = useQuery(orpc.stores.list.queryOptions({ input: { page: 1, pageSize: 100 } }));
  const [sku, setSku] = useState('');
  const [storeCode, setStoreCode] = useState('');
  const [quantityChange, setQuantityChange] = useState('');
  const [reason, setReason] = useState('');
  const [result, setResult] = useState<StockAdjustmentResult | null>(null);

  const adjust = useMutation(
    orpc.inventory.adjust.mutationOptions({
      onSuccess: (data) => {
        setResult(data);
        setQuantityChange('');
        setReason('');
        queryClient.invalidateQueries({ queryKey: orpc.audit.list.key() });
      },
    }),
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">ปรับสต็อกสินค้า</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-wrap items-end gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            setResult(null);
            adjust.mutate({
              sku,
              storeCode,
              quantityChange: Number(quantityChange),
              reason,
            });
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="adjust-sku">รหัสสินค้า (SKU)</Label>
            <Input
              id="adjust-sku"
              value={sku}
              required
              onChange={(event) => setSku(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="adjust-store">สาขา</Label>
            <select
              id="adjust-store"
              className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs"
              value={storeCode}
              required
              onChange={(event) => setStoreCode(event.target.value)}
            >
              <option value="">เลือกสาขา</option>
              {stores.data?.items.map((store) => (
                <option key={store.id} value={store.code}>
                  {store.code} - {store.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="adjust-quantity">จำนวนที่ปรับ (+ เพิ่ม / - ลด)</Label>
            <Input
              id="adjust-quantity"
              inputMode="numeric"
              value={quantityChange}
              required
              onChange={(event) => setQuantityChange(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="adjust-reason">เหตุผล</Label>
            <Input
              id="adjust-reason"
              value={reason}
              required
              onChange={(event) => setReason(event.target.value)}
            />
          </div>
          <Button type="submit" disabled={adjust.isPending}>
            {adjust.isPending ? 'กำลังบันทึก…' : 'บันทึกการปรับสต็อก'}
          </Button>
          {result && (
            <p role="status" className="w-full text-sm text-muted-foreground">
              ปรับสต็อก {result.sku} สาขา {result.storeCode} สำเร็จ: จาก {result.balanceBefore} เป็น{' '}
              {result.balanceAfter}
            </p>
          )}
          {adjust.isError && (
            <p role="alert" className="w-full text-sm text-destructive">
              {errorMessage(adjust.error)}
            </p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}

export function StockAdjustmentsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">ปรับสต็อก</h1>
        <p className="text-muted-foreground">
          เพิ่มหรือลดสต็อกสินค้าของสาขา โดยต้องระบุเหตุผลทุกครั้ง การลดเกินยอดคงเหลือจะถูกปฏิเสธ
          และทุกการปรับจะถูกบันทึกในบันทึกการตรวจสอบ
        </p>
      </div>
      <AdjustStockForm />
      <div className="space-y-2">
        <h2 className="text-lg font-semibold">บันทึกการตรวจสอบ</h2>
        <AuditLog />
      </div>
    </div>
  );
}
