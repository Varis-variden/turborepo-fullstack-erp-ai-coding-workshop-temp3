import type { Product } from '@erp/contracts';
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

function thresholdSummary(product: Product): string {
  return product.reorderThresholds.length > 0
    ? product.reorderThresholds.map((t) => `${t.storeCode}: ${t.threshold}`).join(', ')
    : '—';
}

function ProductRow({ product, canManage }: { product: Product; canManage: boolean }) {
  const queryClient = useQueryClient();
  const setActive = useMutation(
    orpc.products.setActive.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries({ queryKey: orpc.products.list.key() }),
    }),
  );

  return (
    <tr className="border-b last:border-0">
      <td className="px-4 py-3 font-mono text-sm text-muted-foreground">{product.sku}</td>
      <td className="px-4 py-3">{product.name}</td>
      <td className="px-4 py-3">{product.category}</td>
      <td className="px-4 py-3">{product.unit}</td>
      <td className="px-4 py-3 text-right">{product.sellingPrice}</td>
      <td className="px-4 py-3 text-sm">{thresholdSummary(product)}</td>
      <td className="px-4 py-3">
        <Badge variant={product.active ? 'default' : 'secondary'}>
          {product.active ? 'ใช้งาน' : 'ปิดใช้งาน'}
        </Badge>
      </td>
      {canManage && (
        <td className="px-4 py-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={setActive.isPending}
            aria-label={`${product.active ? 'ปิดใช้งาน' : 'เปิดใช้งาน'} ${product.sku}`}
            onClick={() => setActive.mutate({ id: product.id, active: !product.active })}
          >
            {product.active ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}
          </Button>
          {setActive.isError && (
            <p role="alert" className="mt-1 text-sm text-destructive">
              {errorMessage(setActive.error)}
            </p>
          )}
        </td>
      )}
    </tr>
  );
}

function ProductList({
  includeInactive,
  canManage,
}: {
  includeInactive: boolean;
  canManage: boolean;
}) {
  const products = useQuery(
    orpc.products.list.queryOptions({
      input: { page: 1, pageSize: 20, status: includeInactive ? 'ALL' : 'ACTIVE' },
    }),
  );

  if (products.isPending) return <p className="text-muted-foreground">กำลังโหลด…</p>;
  if (products.isError) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {errorMessage(products.error)}
      </p>
    );
  }
  if (products.data.items.length === 0) {
    return <p className="text-muted-foreground">ยังไม่มีสินค้า</p>;
  }

  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-left">
        <thead className="border-b bg-muted/50 text-sm">
          <tr>
            <th className="px-4 py-2 font-medium">รหัสสินค้า (SKU)</th>
            <th className="px-4 py-2 font-medium">ชื่อสินค้า</th>
            <th className="px-4 py-2 font-medium">หมวดหมู่</th>
            <th className="px-4 py-2 font-medium">หน่วยนับ</th>
            <th className="px-4 py-2 text-right font-medium">ราคาขาย (บาท)</th>
            <th className="px-4 py-2 font-medium">จุดสั่งซื้อซ้ำ</th>
            <th className="px-4 py-2 font-medium">สถานะ</th>
            {canManage && <th className="px-4 py-2 font-medium">การจัดการ</th>}
          </tr>
        </thead>
        <tbody>
          {products.data.items.map((product: Product) => (
            <ProductRow key={product.id} product={product} canManage={canManage} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CreateProductForm() {
  const queryClient = useQueryClient();
  const stores = useQuery(orpc.stores.list.queryOptions({ input: { page: 1, pageSize: 100 } }));
  const [sku, setSku] = useState('');
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [unit, setUnit] = useState('');
  const [sellingPrice, setSellingPrice] = useState('');
  const [active, setActive] = useState(true);
  const [thresholds, setThresholds] = useState<Record<string, string>>({});

  const create = useMutation(
    orpc.products.create.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: orpc.products.list.key() });
        setSku('');
        setName('');
        setCategory('');
        setUnit('');
        setSellingPrice('');
        setActive(true);
        setThresholds({});
      },
    }),
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">เพิ่มสินค้าใหม่</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-wrap items-end gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate({
              sku,
              name,
              category,
              unit,
              sellingPrice,
              active,
              reorderThresholds: Object.entries(thresholds)
                .filter(([, value]) => value.trim() !== '')
                .map(([storeCode, value]) => ({ storeCode, threshold: Number(value) })),
            });
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="product-sku">รหัสสินค้า (SKU)</Label>
            <Input
              id="product-sku"
              value={sku}
              required
              onChange={(event) => setSku(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="product-name">ชื่อสินค้า</Label>
            <Input
              id="product-name"
              value={name}
              required
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="product-category">หมวดหมู่</Label>
            <Input
              id="product-category"
              value={category}
              required
              onChange={(event) => setCategory(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="product-unit">หน่วยนับ</Label>
            <Input
              id="product-unit"
              value={unit}
              required
              onChange={(event) => setUnit(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="product-price">ราคาขาย (บาท)</Label>
            <Input
              id="product-price"
              inputMode="decimal"
              value={sellingPrice}
              required
              onChange={(event) => setSellingPrice(event.target.value)}
            />
          </div>
          {stores.data?.items.map((store) => (
            <div key={store.id} className="space-y-2">
              <Label htmlFor={`product-threshold-${store.code}`}>
                จุดสั่งซื้อซ้ำ สาขา {store.code}
              </Label>
              <Input
                id={`product-threshold-${store.code}`}
                inputMode="numeric"
                value={thresholds[store.code] ?? ''}
                onChange={(event) =>
                  setThresholds((current) => ({ ...current, [store.code]: event.target.value }))
                }
              />
            </div>
          ))}
          <div className="flex items-center gap-2 pb-2">
            <input
              id="product-active"
              type="checkbox"
              checked={active}
              onChange={(event) => setActive(event.target.checked)}
            />
            <Label htmlFor="product-active">สินค้าใช้งานอยู่</Label>
          </div>
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? 'กำลังบันทึก…' : 'เพิ่มสินค้า'}
          </Button>
          {create.isError && (
            <p role="alert" className="w-full text-sm text-destructive">
              {errorMessage(create.error)}
            </p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}

export function ProductsPage() {
  const user = useCurrentUser();
  const isAdmin = user?.role === 'ADMIN';
  const [includeInactive, setIncludeInactive] = useState(false);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">สินค้า</h1>
        <p className="text-muted-foreground">
          จัดการรหัสสินค้า ราคาขาย และจุดสั่งซื้อซ้ำของแต่ละสาขา
          สินค้าที่ปิดใช้งานจะไม่แสดงในเอกสารใหม่ แต่ยังค้นหาได้ในประวัติ
        </p>
      </div>
      {isAdmin && <CreateProductForm />}
      <div className="flex items-center gap-2">
        <input
          id="show-inactive"
          type="checkbox"
          checked={includeInactive}
          onChange={(event) => setIncludeInactive(event.target.checked)}
        />
        <Label htmlFor="show-inactive">แสดงสินค้าที่ปิดใช้งาน</Label>
      </div>
      <ProductList includeInactive={includeInactive} canManage={isAdmin} />
    </div>
  );
}
