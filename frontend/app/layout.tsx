import type { Metadata } from "next";
import "./globals.css";
import { AppFrame } from "@/components/app-frame";

export const metadata: Metadata = {
  title: "PRO-SYS | Life ERP",
  description: "Life Reminder Management System",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className="flex h-screen overflow-hidden bg-background text-foreground">
        <AppFrame>{children}</AppFrame>
      </body>
    </html>
  );
}
