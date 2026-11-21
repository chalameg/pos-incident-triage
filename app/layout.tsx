import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "POS Incident Triage",
  description:
    "A human-reviewed checkout incident workflow. Synthetic data, durable evidence, and clear escalation.",
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
