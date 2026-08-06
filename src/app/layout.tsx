import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "司法書士 学習記録",
  description: "苦手の蓄積と傾向分析、やるべきことの管理",
};

const NAV = [
  { href: "/", label: "ホーム" },
  { href: "/mistakes", label: "苦手ノート" },
  { href: "/mistakes/new", label: "記録する" },
  { href: "/results", label: "成績" },
  { href: "/analysis", label: "傾向分析" },
  { href: "/plan", label: "計画" },
];

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ja" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <header className="sticky top-0 z-10 bg-card border-b border-line">
          <nav className="max-w-4xl mx-auto flex gap-1 overflow-x-auto px-3 py-2 text-sm">
            {NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className="whitespace-nowrap rounded-lg px-3 py-1.5 hover:bg-background"
              >
                {n.label}
              </Link>
            ))}
          </nav>
        </header>
        <main className="max-w-4xl w-full mx-auto flex-1 px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
