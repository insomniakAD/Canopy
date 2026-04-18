import { Sidebar } from "@/components/sidebar";
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
        <main className="flex-1 ml-56 p-8 overflow-auto">
          {children}
        </main>
      </div>
    </AuthProvider>
  );
}
