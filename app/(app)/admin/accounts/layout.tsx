import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Accounts",
  description: "Approve, suspend and grant plans across every account.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
