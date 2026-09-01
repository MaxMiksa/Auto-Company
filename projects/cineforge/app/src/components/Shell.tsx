"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  ["/studio", "创作台"],
  ["/assets", "素材库"],
  ["/voices", "声音克隆"],
  ["/humans", "人生克隆"],
  ["/settings", "设置"],
] as const;

export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();

  // 落地页是剧场开场，不要侧栏操作壳
  if (path === "/") {
    return <>{children}</>;
  }

  return (
    <div className="app">
      <nav className="nav">
        <div className="brand">
          镜场
          <small>CINEFORGE</small>
        </div>
        <div style={{ marginTop: 28 }}>
          {LINKS.map(([href, label]) => (
            <Link key={href} href={href} className={path === href ? "active" : ""}>
              {label}
            </Link>
          ))}
        </div>
      </nav>
      <main className="main">{children}</main>
    </div>
  );
}
