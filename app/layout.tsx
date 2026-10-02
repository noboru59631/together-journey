import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Together — AI Journey Partner",
  description: "Turn shared cultural taste into one real-world next adventure.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
