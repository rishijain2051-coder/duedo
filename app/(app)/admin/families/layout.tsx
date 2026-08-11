import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Families",
  description: "Every household on this install and who is in it.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
