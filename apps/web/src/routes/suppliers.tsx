import type { Supplier } from '@erp/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useCurrentUser } from '@/lib/auth';
import { orpc } from '@/lib/orpc';

/** The actionable Thai copy for an error, whether it came from the API or a lost connection. */
function errorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง';
}

/** The contact details for a supplier, joined for display, or a dash when none are recorded. */
function contactSummary(supplier: Supplier): string {
  const parts = [supplier.contactName, supplier.contactPhone, supplier.contactEmail].filter(
    (value): value is string => Boolean(value),
  );
  return parts.length > 0 ? parts.join(' · ') : '—';
}

function SupplierList() {
  const suppliers = useQuery(
    orpc.suppliers.list.queryOptions({ input: { page: 1, pageSize: 20 } }),
  );

  if (suppliers.isPending) return <p className="text-muted-foreground">กำลังโหลด…</p>;
  if (suppliers.isError) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {errorMessage(suppliers.error)}
      </p>
    );
  }
  if (suppliers.data.items.length === 0) {
    return <p className="text-muted-foreground">ยังไม่มีผู้จัดจำหน่าย</p>;
  }

  return (
    <ul className="divide-y rounded-md border">
      {suppliers.data.items.map((supplier: Supplier) => (
        <li key={supplier.id} className="flex items-center gap-4 px-4 py-3">
          <span className="font-mono text-sm text-muted-foreground">{supplier.code}</span>
          <span>{supplier.name}</span>
          <span className="ml-auto text-sm text-muted-foreground">{contactSummary(supplier)}</span>
        </li>
      ))}
    </ul>
  );
}

function CreateSupplierForm() {
  const queryClient = useQueryClient();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [contactEmail, setContactEmail] = useState('');

  const create = useMutation(
    orpc.suppliers.create.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: orpc.suppliers.list.key() });
        setCode('');
        setName('');
        setContactName('');
        setContactPhone('');
        setContactEmail('');
      },
    }),
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">เพิ่มผู้จัดจำหน่ายใหม่</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-wrap items-end gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate({ code, name, contactName, contactPhone, contactEmail });
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="supplier-code">รหัสผู้จัดจำหน่าย</Label>
            <Input
              id="supplier-code"
              value={code}
              required
              onChange={(event) => setCode(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="supplier-name">ชื่อผู้จัดจำหน่าย</Label>
            <Input
              id="supplier-name"
              value={name}
              required
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="supplier-contact-name">ชื่อผู้ติดต่อ</Label>
            <Input
              id="supplier-contact-name"
              value={contactName}
              onChange={(event) => setContactName(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="supplier-contact-phone">เบอร์โทร</Label>
            <Input
              id="supplier-contact-phone"
              value={contactPhone}
              onChange={(event) => setContactPhone(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="supplier-contact-email">อีเมล</Label>
            <Input
              id="supplier-contact-email"
              type="email"
              value={contactEmail}
              onChange={(event) => setContactEmail(event.target.value)}
            />
          </div>
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? 'กำลังบันทึก…' : 'เพิ่มผู้จัดจำหน่าย'}
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

export function SuppliersPage() {
  const user = useCurrentUser();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">ผู้จัดจำหน่าย</h1>
        <p className="text-muted-foreground">
          จัดการรหัส ชื่อ และข้อมูลติดต่อของผู้จัดจำหน่ายที่ใช้อ้างอิงในใบสั่งซื้อ
        </p>
      </div>
      {user?.role === 'ADMIN' && <CreateSupplierForm />}
      <SupplierList />
    </div>
  );
}
