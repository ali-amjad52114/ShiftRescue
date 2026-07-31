import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Fraunces, Inter } from "next/font/google";
import "./globals.css";

// Grenette (display serif) substitute per DESIGN.md; used only at 36px+.
const display = Fraunces({
  subsets: ["latin"],
  weight: ["400"],
  variable: "--font-display",
  display: "swap",
});

// Graphik (UI sans) substitute per DESIGN.md.
const ui = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-ui",
  display: "swap",
});

export const metadata: Metadata = {
  title: "ShiftRescue — Live Voice AI Workflow",
  description: "Voice-first shift coverage demo",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" className={`${display.variable} ${ui.variable}`}>
      <body>
        <header className="topbar">
          <div className="topbar-inner">
            <span className="brand">
              <span className="brand-mark" aria-hidden="true">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 3v9l6 3" />
                  <circle cx="12" cy="12" r="9" />
                </svg>
              </span>
              ShiftRescue
            </span>
            <nav className="nav-links" aria-label="Primary">
              <a className="nav-pill" href="/" aria-current="page">
                Dashboard
              </a>
            </nav>
          </div>
        </header>

        {children}

        <footer className="footer">
          <div className="footer-inner">
            <span>One uncovered shift, closed by a voice agent.</span>
            <span>VoiceOS · Vapi + OpenAI · a1mobile</span>
          </div>
        </footer>
      </body>
    </html>
  );
}
