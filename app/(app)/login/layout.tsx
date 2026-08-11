import type { Metadata } from "next";

// The page itself is a client component and cannot export metadata, so it lives here.
export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to DueDo with Face ID or your PIN.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
