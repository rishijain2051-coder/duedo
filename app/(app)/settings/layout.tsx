import type { Metadata } from "next";

// The page itself is a client component and cannot export metadata, so it lives here.
export const metadata: Metadata = {
  title: "Settings",
  description: "Alerts, passkeys, devices, your family, and your plan.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
