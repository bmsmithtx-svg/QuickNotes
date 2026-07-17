import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "QuickNotes",
  description: "School-focused AI study workspace with citation-backed answers."
};

export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#090B10"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body>{children}</body>
    </html>
  );
}
