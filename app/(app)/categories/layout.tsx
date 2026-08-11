import type { Metadata } from "next";

// The page itself is a client component and cannot export metadata, so it lives here.
export const metadata: Metadata = {
  title: "Categories",
  description: "The categories your reminders are filed under, and what each is spending.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
