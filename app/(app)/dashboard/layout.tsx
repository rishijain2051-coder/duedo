import type { Metadata } from "next";

// The page itself is a client component and cannot export metadata, so it lives here.
export const metadata: Metadata = {
  title: "Dashboard",
  description: "What is due today, what is overdue, and what you have spent this month.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
