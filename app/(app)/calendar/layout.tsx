import type { Metadata } from "next";

// The page itself is a client component and cannot export metadata, so it lives here.
export const metadata: Metadata = {
  title: "Calendar",
  description: "Your reminders by month, across your own list and the shared one.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
