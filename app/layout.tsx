import type { Metadata, Viewport } from "next";
import "./globals.css";
import RegisterSW from "./RegisterSW";
import { Analytics } from "@vercel/analytics/next"

export const metadata: Metadata = {
  title: "Nearest Shop Compass",
  description: "Points you toward the nearest liquor shop in Dewas.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Compass",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#111111",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="apple-touch-icon" href="/icon-192.png" />
      </head>
      <body style={{ margin: 0 }}>
        {children}
        <RegisterSW />
        <Analytics />
      </body>
    </html>
  );
}
