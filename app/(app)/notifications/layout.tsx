import type { Metadata } from "next";

// The page itself is a client component and cannot export metadata, so it lives here.
export const metadata: Metadata = {
  title: "Notifications",
  description: "Every alert DueDo has sent you, and what it was for.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
