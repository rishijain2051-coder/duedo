import type { Metadata } from "next";

// The page itself is a client component and cannot export metadata, so it lives here.
export const metadata: Metadata = {
  title: "Spending",
  description: "What you have spent by category, against the last three months.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
