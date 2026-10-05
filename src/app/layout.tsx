import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Wahid", template: "%s · Wahid" },
  description: "Procurement for Dubai contractors. Send the BOQ - AI matches suppliers, compares quotes and tracks delivery; people approve.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans">{children}</body>
    </html>
  );
}
