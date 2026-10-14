"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { useAuth } from "@/contexts/auth-context";

const links = [
  { href: "/dashboard", label: "Overview", icon: "⌂" },
  { href: "/chat", label: "Career chat", icon: "✳" },
  { href: "/resumes", label: "My resumes", icon: "▤" },
  { href: "/consultations", label: "Consultations", icon: "◷" },
  { href: "/profile", label: "Profile & settings", icon: "◎" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, signOut } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const pathname = usePathname();
  const router = useRouter();

  async function handleSignOut() {
    setLoggingOut(true);
    try {
      await signOut();
    } catch {
      // Local tokens are cleared even if the server cannot be reached.
    } finally {
      router.replace("/");
      setLoggingOut(false);
    }
  }

  return (
    <div className="workspace">
      <aside className={`sidebar ${menuOpen ? "sidebar-open" : ""}`}>
        <Link href="/dashboard" className="brand brand-workspace" onClick={() => setMenuOpen(false)}>
          <span className="brand-mark">CP</span><span>Career Platform</span>
        </Link>
        <p className="nav-caption">YOUR WORKSPACE</p>
        <nav className="side-nav" aria-label="Workspace navigation">
          {links.map((item) => {
            const active = pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(`${item.href}/`));
            return <Link key={item.href} href={item.href} className={active ? "active" : ""} onClick={() => setMenuOpen(false)}>
              <span className="side-icon" aria-hidden="true">{item.icon}</span>{item.label}
            </Link>;
          })}
        </nav>
        <div className="sidebar-bottom">
          <div className="profile-chip">
            <span className="avatar">{user?.name?.slice(0, 1).toUpperCase() ?? "U"}</span>
            <span className="profile-name"><strong>{user?.name}</strong><small>{user?.email}</small></span>
          </div>
          <button className="logout-button" onClick={handleSignOut} disabled={loggingOut}>
            {loggingOut ? "Signing out…" : "Sign out"}
          </button>
        </div>
      </aside>
      {menuOpen && <button className="nav-scrim" aria-label="Close navigation" onClick={() => setMenuOpen(false)} />}
      <div className="workspace-main">
        <header className="mobile-bar">
          <button className="menu-toggle" aria-label="Open navigation" onClick={() => setMenuOpen((open) => !open)}>☰</button>
          <Link href="/dashboard" className="brand"><span className="brand-mark">CP</span>Career Platform</Link>
          <span className="mobile-avatar">{user?.name?.slice(0, 1).toUpperCase()}</span>
        </header>
        <main className="workspace-content">{children}</main>
      </div>
    </div>
  );
}
