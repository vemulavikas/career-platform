import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AuthProvider } from "@/contexts/auth-context";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Career Platform",
    template: "%s | Career Platform",
  },
  description: "A thoughtful workspace for career conversations, resume drafts, and consultations.",
  applicationName: "Career Platform",
  openGraph: {
    title: "Career Platform",
    description: "A thoughtful workspace for the work ahead.",
    type: "website",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body><AuthProvider>{children}</AuthProvider></body>
    </html>
  );
}
