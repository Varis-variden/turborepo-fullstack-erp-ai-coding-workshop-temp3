import type { PurchaseOrder } from '@erp/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useCurrentUser } from '@/lib/auth';
import { orpc } from '@/lib/orpc';

const FALLBACK_ERROR = 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง';
const SELECT_CLASS = 'h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs';

const STATUS_LABEL: Record<PurchaseOrder['status'], string> = {
  DRAFT: 'ฉบับร่าง',
  PENDING_APPROVAL: 'รออนุมัติ',
  APPROVED: 'อนุมัติแล้ว',
  REJECTED: 'ถูกปฏิเสธ',
  CANCELLED: 'ยกเลิกแล้ว',
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

function OrderCard({ order }: { order: PurchaseOrder }) {
  return (
    <section aria-label={order.number} className="space-y-3 rounded-md border p-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-mono text-lg font-semibold">{order.number}</h2>
        <Badge variant="secondary">{STATUS_LABEL[order.status]}</Badge>
        <span className="text-sm text-muted-foreground">
          {order.supplierName} · สาขา {order.storeName} · คาดว่าจะได้รับ {order.expectedReceiptDate}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b bg-muted/50">
            <tr>
              <th className="px-3 py-2 font-medium">รหัสสินค้า (SKU)</th>
              <th className="px-3 py-2 font-medium">ชื่อสินค้า</th>
              <th className="px-3 py-2 font-medium">หน่วยนับ</th>
              <th className="px-3 py-2 text-right font-medium">จำนวนที่สั่ง</th>
              <th className="px-3 py-2 text-right font-medium">ราคาซื้อต่อหน่วย (บาท)</th>
            </tr>
          </thead>
          <tbody>
            {order.lines.map((line) => (
              <tr key={line.id} className="border-b last:border-0">
                <td className="px-3 py-2 font-mono text-muted-foreground">{line.sku}</td>
                <td className="px-3 py-2">{line.name}</td>
                <td className="px-3 py-2">{line.unit}</td>
                <td className="px-3 py-2 text-right">{line.quantity}</td>
                <td className="px-3 py-2 text-right">{line.unitPrice}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function OrderList() {
  const orders = useQuery(
    orpc.purchaseOrders.list.queryOptions({ input: { page: 1, pageSize: 20 } }),
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
    return <p className="text-muted-foreground">ยังไม่มีใบสั่งซื้อ</p>;
  }

  return (
    <div className="space-y-4">
      {orders.data.items.map((order) => (
        <OrderCard key={order.id} order={order} />
      ))}
    </div>
  );
}

interface LineDraft {
  key: number;
  sku: string;
  quantity: string;
  unitPrice: string;
}

function CreateOrderForm() {
  const queryClient = useQueryClient();
  const suppliers = useQuery(
    orpc.suppliers.list.queryOptions({ input: { page: 1, pageSize: 100 } }),
  );
  const stores = useQuery(orpc.stores.list.queryOptions({ input: { page: 1, pageSize: 100 } }));
  const products = useQuery(
    orpc.products.list.queryOptions({ input: { page: 1, pageSize: 100, status: 'ACTIVE' } }),
  );

  const [supplierCode, setSupplierCode] = useState('');
  const [storeCode, setStoreCode] = useState('');
  const [expectedReceiptDate, setExpectedReceiptDate] = useState('');
  const [nextKey, setNextKey] = useState(2);
  const [lines, setLines] = useState<LineDraft[]>([
    { key: 1, sku: '', quantity: '', unitPrice: '' },
  ]);

  const create = useMutation(
    orpc.purchaseOrders.create.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: orpc.purchaseOrders.list.key() });
        setSupplierCode('');
        setStoreCode('');
        setExpectedReceiptDate('');
        setNextKey(2);
        setLines([{ key: 1, sku: '', quantity: '', unitPrice: '' }]);
      },
    }),
  );

  function updateLine(key: number, patch: Partial<LineDraft>) {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">สร้างใบสั่งซื้อฉบับร่าง</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate({
              supplierCode,
              storeCode,
              expectedReceiptDate,
              lines: lines.map((line) => ({
                sku: line.sku,
                quantity: Number(line.quantity),
                unitPrice: line.unitPrice,
              })),
            });
          }}
        >
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-2">
              <Label htmlFor="po-supplier">ผู้จัดจำหน่าย</Label>
              <select
                id="po-supplier"
                className={SELECT_CLASS}
                value={supplierCode}
                required
                onChange={(event) => setSupplierCode(event.target.value)}
              >
                <option value="">เลือกผู้จัดจำหน่าย</option>
                {suppliers.data?.items.map((supplier) => (
                  <option key={supplier.id} value={supplier.code}>
                    {supplier.code} - {supplier.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="po-store">สาขาปลายทาง</Label>
              <select
                id="po-store"
                className={SELECT_CLASS}
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
              <Label htmlFor="po-date">วันที่คาดว่าจะได้รับสินค้า</Label>
              <Input
                id="po-date"
                type="date"
                value={expectedReceiptDate}
                required
                onChange={(event) => setExpectedReceiptDate(event.target.value)}
              />
            </div>
          </div>

          {lines.map((line, index) => {
            const position = index + 1;
            return (
              <div key={line.key} className="flex flex-wrap items-end gap-4">
                <div className="space-y-2">
                  <Label htmlFor={`po-line-sku-${line.key}`}>
                    สินค้า (SKU) รายการที่ {position}
                  </Label>
                  <select
                    id={`po-line-sku-${line.key}`}
                    className={SELECT_CLASS}
                    value={line.sku}
                    required
                    onChange={(event) => updateLine(line.key, { sku: event.target.value })}
                  >
                    <option value="">เลือกสินค้า</option>
                    {products.data?.items.map((product) => (
                      <option key={product.id} value={product.sku}>
                        {product.sku} - {product.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`po-line-qty-${line.key}`}>
                    จำนวนที่สั่ง รายการที่ {position}
                  </Label>
                  <Input
                    id={`po-line-qty-${line.key}`}
                    inputMode="numeric"
                    value={line.quantity}
                    required
                    onChange={(event) => updateLine(line.key, { quantity: event.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`po-line-price-${line.key}`}>
                    ราคาซื้อต่อหน่วย (บาท) รายการที่ {position}
                  </Label>
                  <Input
                    id={`po-line-price-${line.key}`}
                    inputMode="decimal"
                    value={line.unitPrice}
                    required
                    onChange={(event) => updateLine(line.key, { unitPrice: event.target.value })}
                  />
                </div>
                {lines.length > 1 && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-label={`ลบรายการที่ ${position}`}
                    onClick={() => setLines((current) => current.filter((l) => l.key !== line.key))}
                  >
                    ลบ
                  </Button>
                )}
              </div>
            );
          })}

          <div className="flex flex-wrap items-center gap-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setLines((current) => [
                  ...current,
                  { key: nextKey, sku: '', quantity: '', unitPrice: '' },
                ]);
                setNextKey((key) => key + 1);
              }}
            >
              เพิ่มรายการสินค้า
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? 'กำลังบันทึก…' : 'สร้างใบสั่งซื้อฉบับร่าง'}
            </Button>
          </div>
          {create.isError && (
            <p role="alert" className="text-sm text-destructive">
              {errorMessage(create.error)}
            </p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}

export function PurchaseOrdersPage() {
  const user = useCurrentUser();
  const canCreate = user?.role === 'PURCHASING';
  const canView = user?.role === 'PURCHASING' || user?.role === 'MANAGER' || user?.role === 'ADMIN';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">ใบสั่งซื้อ</h1>
        <p className="text-muted-foreground">
          สร้างใบสั่งซื้อฉบับร่างพร้อมผู้จัดจำหน่าย สาขาปลายทาง และรายการสินค้า
          การสร้างใบสั่งซื้อไม่เปลี่ยนจำนวนสต็อก
        </p>
      </div>
      {user && !canView ? (
        <p className="text-muted-foreground">บัญชีนี้ไม่มีสิทธิ์ดูใบสั่งซื้อ</p>
      ) : (
        <>
          {canCreate && <CreateOrderForm />}
          {canView && <OrderList />}
        </>
      )}
    </div>
  );
}
