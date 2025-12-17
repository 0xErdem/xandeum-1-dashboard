import type { Metadata } from "next";
import { Inter, Rajdhani } from "next/font/google"; 
import "./globals.css";
import AppWalletProvider from "../components/AppWalletProvider";

const inter = Inter({ subsets: ["latin"], variable: '--font-inter' });
const rajdhani = Rajdhani({ 
  subsets: ["latin"], 
  weight: ['400', '500', '600', '700'],
  variable: '--font-rajdhani'
});

export const metadata: Metadata = {
  title: "Xandeum Network Explorer",
  description: "Next-Gen Gossip Analytics Dashboard",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body 
        className={`${inter.variable} ${rajdhani.variable} font-sans`}
        suppressHydrationWarning={true}
      >
        <AppWalletProvider>
           {children}
        </AppWalletProvider>
      </body>
    </html>
  );
}