import "./globals.css";
import RegisterSW from "./RegisterSW";

export const metadata = {
  title: "Nearest Shop Compass",
  description: "Points you toward the nearest liquor shop in Dewas.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Compass",
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#111111",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="apple-touch-icon" href="/icon-192.png" />
      </head>
      <body style={{ margin: 0 }}>
        {children}
        <RegisterSW />
      </body>
    </html>
  );
}
