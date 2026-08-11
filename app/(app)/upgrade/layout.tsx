import type { Metadata } from "next";

// The page itself is a client component and cannot export metadata, so it lives here.
export const metadata: Metadata = {
  title: "Upgrade",
  description: "Individual and Family plans, paid once a year with no card on file.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
