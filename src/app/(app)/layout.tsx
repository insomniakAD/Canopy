import { Sidebar } from "@/components/sidebar";
import { Topbar } from "@/components/topbar";
import { AuthProvider } from "@/components/session-provider";

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthProvider>
      <div className="flex min-h-screen">
        <Sidebar />
        <Topbar />
        {/* pt accounts for fixed 56px topbar; px/pb match the old p-8 */}
        <main className="flex-1 ml-60 px-8 pb-8 pt-[calc(3.5rem+2rem)] overflow-auto">
          {children}
        </main>
      </div>
    </AuthProvider>
  );
}
