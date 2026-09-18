import type { Metadata } from "next";
import "./globals.css";

import NotificationBell from "./notification-bell";

export const metadata: Metadata = {
  title: "小贝",
  description: "xiaobei web 控制台",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">
        {children}
        <NotificationBell />
      </body>
    </html>
  );
}
