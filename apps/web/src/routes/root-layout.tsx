import { NavLink, Outlet } from 'react-router';
import { UserMenu } from '@/components/user-menu';
import { useCurrentUser } from '@/lib/auth';
import { cn } from '@/lib/utils';

export function RootLayout() {
  const user = useCurrentUser();
  return (
    <div className="min-h-svh bg-background text-foreground">
      <header className="border-b">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-6 font-semibold">
          <div className="flex items-center gap-6">
            ERP Workshop
            <nav className="flex items-center gap-4 text-sm font-normal">
              <NavLink
                to="/products"
                className={({ isActive }) =>
                  cn('text-muted-foreground hover:text-foreground', isActive && 'text-foreground')
                }
              >
                สินค้า
              </NavLink>
              <NavLink
                to="/inventory"
                className={({ isActive }) =>
                  cn('text-muted-foreground hover:text-foreground', isActive && 'text-foreground')
                }
              >
                สต็อก
              </NavLink>
              {user?.role === 'MANAGER' && (
                <NavLink
                  to="/stock-adjustments"
                  className={({ isActive }) =>
                    cn('text-muted-foreground hover:text-foreground', isActive && 'text-foreground')
                  }
                >
                  ปรับสต็อก
                </NavLink>
              )}
              <NavLink
                to="/stores"
                className={({ isActive }) =>
                  cn('text-muted-foreground hover:text-foreground', isActive && 'text-foreground')
                }
              >
                สาขา
              </NavLink>
              <NavLink
                to="/suppliers"
                className={({ isActive }) =>
                  cn('text-muted-foreground hover:text-foreground', isActive && 'text-foreground')
                }
              >
                ผู้จัดจำหน่าย
              </NavLink>
              <NavLink
                to="/purchase-orders"
                className={({ isActive }) =>
                  cn('text-muted-foreground hover:text-foreground', isActive && 'text-foreground')
                }
              >
                ใบสั่งซื้อ
              </NavLink>
            </nav>
          </div>
          <UserMenu />
        </div>
      </header>
      <main className="mx-auto max-w-5xl p-6">
        <Outlet />
      </main>
    </div>
  );
}
