import { NavLink, Outlet } from 'react-router';
import { UserMenu } from '@/components/user-menu';
import { cn } from '@/lib/utils';

export function RootLayout() {
  return (
    <div className="min-h-svh bg-background text-foreground">
      <header className="border-b">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-6 font-semibold">
          <div className="flex items-center gap-6">
            ERP Workshop
            <nav className="flex items-center gap-4 text-sm font-normal">
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
