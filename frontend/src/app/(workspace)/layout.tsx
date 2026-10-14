import { AppShell } from "@/components/app-shell";
import { ProtectedArea } from "@/contexts/auth-context";

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  return <ProtectedArea><AppShell>{children}</AppShell></ProtectedArea>;
}
