import type { Metadata } from "next";

// The page itself is a client component and cannot export metadata, so it lives here.
export const metadata: Metadata = {
  title: "Reminders",
  description: "Every reminder on your list and your family's, with what is due when.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
