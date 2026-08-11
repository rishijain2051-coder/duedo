import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Delivery health",
  description: "Whether the scheduler fired, what the app replied, and what was sent.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
