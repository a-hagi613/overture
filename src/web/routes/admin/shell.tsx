import { Outlet } from "react-router";

import { AdminHeader } from "./admin-header.tsx";

export function AdminShell() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-[1200px] px-4 pb-10 pt-[26px] md:px-9">
        <AdminHeader />
        <main>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
