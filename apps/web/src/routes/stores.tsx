import type { Store } from '@erp/contracts';
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

function StoreList() {
  const stores = useQuery(orpc.stores.list.queryOptions({ input: { page: 1, pageSize: 20 } }));

  if (stores.isPending) return <p className="text-muted-foreground">กำลังโหลด…</p>;
  if (stores.isError) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {errorMessage(stores.error)}
      </p>
    );
  }
  if (stores.data.items.length === 0) {
    return <p className="text-muted-foreground">ยังไม่มีสาขา</p>;
  }

  return (
    <ul className="divide-y rounded-md border">
      {stores.data.items.map((store: Store) => (
        <li key={store.id} className="flex items-center gap-4 px-4 py-3">
          <span className="font-mono text-sm text-muted-foreground">{store.code}</span>
          <span>{store.name}</span>
        </li>
      ))}
    </ul>
  );
}

function CreateStoreForm() {
  const queryClient = useQueryClient();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');

  const create = useMutation(
    orpc.stores.create.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: orpc.stores.list.key() });
        setCode('');
        setName('');
      },
    }),
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">เพิ่มสาขาใหม่</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-wrap items-end gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate({ code, name });
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="store-code">รหัสสาขา</Label>
            <Input
              id="store-code"
              value={code}
              required
              onChange={(event) => setCode(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="store-name">ชื่อสาขา</Label>
            <Input
              id="store-name"
              value={name}
              required
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? 'กำลังบันทึก…' : 'เพิ่มสาขา'}
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

export function StoresPage() {
  const user = useCurrentUser();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">สาขา</h1>
        <p className="text-muted-foreground">จัดการรหัสและชื่อสาขา แต่ละสาขาคือคลังสินค้าแยกกัน</p>
      </div>
      {user?.role === 'ADMIN' && <CreateStoreForm />}
      <StoreList />
    </div>
  );
}
