import type { Metadata } from "next";
import { IBM_Plex_Sans } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { Banner } from "@/components/Banner";
import { SignOutButton } from "@/components/SignOutButton";

// The sans is IBM Plex Sans, the sibling of the summary's Plex Serif, so the
// page's labels and the hero's prose read as one family. It is the variable
// cut, one file for every weight, and `next/font` serves it from this app's
// own origin. Mono stays the native system stack (see --font-mono in
// globals.css).
const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-plex-sans",
});

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : "https://project-ophanim.vercel.app",
  ),
  title: "Project Ophanim",
  description:
    "Check an IP, domain, or file hash against multiple threat-intelligence sources.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning className={`${plexSans.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem={false}
          disableTransitionOnChange
        >
          <Banner signOut={<SignOutButton />} />
          {children}
        </ThemeProvider>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
