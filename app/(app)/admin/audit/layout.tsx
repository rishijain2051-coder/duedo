import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Audit log",
  description: "Every administrative action, including support reads.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
