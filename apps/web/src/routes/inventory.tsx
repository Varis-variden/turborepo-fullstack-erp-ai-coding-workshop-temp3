import type { StockItem } from '@erp/contracts';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useCurrentUser } from '@/lib/auth';
import { orpc } from '@/lib/orpc';

const FALLBACK_ERROR = 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง';

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : FALLBACK_ERROR;
}

function StockRow({ item }: { item: StockItem }) {
  return (
    <tr className="border-b last:border-0">
      <td className="px-4 py-3 font-mono text-sm text-muted-foreground">{item.sku}</td>
      <td className="px-4 py-3">{item.name}</td>
      <td className="px-4 py-3">{item.storeCode}</td>
      <td className="px-4 py-3 text-right">{item.quantity}</td>
      <td className="px-4 py-3">{item.unit}</td>
      <td className="px-4 py-3 text-right">{item.reorderThreshold ?? '—'}</td>
      <td className="px-4 py-3">
        {item.lowStock ? <Badge variant="destructive">สต็อกต่ำ</Badge> : null}
      </td>
    </tr>
  );
}

function StockTable({ search, storeCode }: { search: string; storeCode: string }) {
  const stock = useQuery(
    orpc.inventory.search.queryOptions({
      input: {
        page: 1,
        pageSize: 20,
        search: search.trim() || undefined,
        storeCode: storeCode || undefined,
      },
    }),
  );

  if (stock.isPending) return <p className="text-muted-foreground">กำลังโหลด…</p>;
  if (stock.isError) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {errorMessage(stock.error)}
      </p>
    );
  }
  if (stock.data.items.length === 0) {
    return <p className="text-muted-foreground">ไม่พบสินค้าในสต็อก</p>;
  }

  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-left">
        <thead className="border-b bg-muted/50 text-sm">
          <tr>
            <th className="px-4 py-2 font-medium">รหัสสินค้า (SKU)</th>
            <th className="px-4 py-2 font-medium">ชื่อสินค้า</th>
            <th className="px-4 py-2 font-medium">สาขา</th>
            <th className="px-4 py-2 text-right font-medium">คงเหลือ</th>
            <th className="px-4 py-2 font-medium">หน่วยนับ</th>
            <th className="px-4 py-2 text-right font-medium">จุดสั่งซื้อซ้ำ</th>
            <th className="px-4 py-2 font-medium">สถานะ</th>
          </tr>
        </thead>
        <tbody>
          {stock.data.items.map((item) => (
            <StockRow key={`${item.productId}-${item.storeCode}`} item={item} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function InventoryPage() {
  const user = useCurrentUser();
  // A store-scoped user only ever sees their own store (enforced at the API), so the store filter
  // is pointless for them. An unassigned user (MANAGER/ADMIN) can narrow to one store.
  const canChooseStore = user?.storeId == null;
  const stores = useQuery(
    orpc.stores.list.queryOptions({ input: { page: 1, pageSize: 100 } }, { enabled: canChooseStore }),
  );
  const [search, setSearch] = useState('');
  const [storeCode, setStoreCode] = useState('');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">สต็อกสินค้า</h1>
        <p className="text-muted-foreground">
          ค้นหาสินค้าตามรหัส ชื่อ และสาขา เพื่อดูจำนวนคงเหลือ หน่วยนับ จุดสั่งซื้อซ้ำ
          และสถานะสต็อกต่ำ (คงเหลือไม่เกินจุดสั่งซื้อซ้ำ)
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-4">
        <div className="space-y-2">
          <Label htmlFor="stock-search">ค้นหาด้วยรหัสสินค้าหรือชื่อสินค้า</Label>
          <Input
            id="stock-search"
            value={search}
            placeholder="เช่น SKU001 หรือ น้ำดื่ม"
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        {canChooseStore && (
          <div className="space-y-2">
            <Label htmlFor="stock-store">สาขา</Label>
            <select
              id="stock-store"
              className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs"
              value={storeCode}
              onChange={(event) => setStoreCode(event.target.value)}
            >
              <option value="">ทุกสาขา</option>
              {stores.data?.items.map((store) => (
                <option key={store.id} value={store.code}>
                  {store.code} - {store.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
      <StockTable search={search} storeCode={storeCode} />
    </div>
  );
}
