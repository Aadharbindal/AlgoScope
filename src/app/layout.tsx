import type { Metadata } from "next";
import { Archivo, Geist_Mono } from "next/font/google";
import "./globals.css";

const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "AlgoScope — see what your code actually does",
  description:
    "A semantic debugger for algorithms. Step through real execution, watch the invariant hold or break, and find the exact step where a buggy solution stops being correct.",
};

/**
 * Theme is resolved before paint so the instrument never flashes the wrong
 * palette. Defaults to dark; an explicit choice wins over the OS.
 */
const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem('algoscope-theme');if(t==='light'||t==='dark'){document.documentElement.setAttribute('data-theme',t);}}catch(e){}})();`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${archivo.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col bg-ground text-ink">{children}</body>
    </html>
  );
}
