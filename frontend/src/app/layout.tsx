import type { Metadata, Viewport } from 'next';
/**
 * Fonts are self-hosted from npm rather than fetched from Google Fonts.
 * No third-party request at runtime, nothing to leak a visitor's IP to another
 * origin, and the build does not depend on an external service being reachable.
 *
 * Two families with clearly different jobs:
 *   IBM Plex Sans   interface text — slightly technical, not the ubiquitous grotesk
 *   Source Serif 4  figures — true tabular lining numerals, so money columns
 *                   align on the decimal the way an accounts book does
 */
import '@fontsource-variable/ibm-plex-sans';
import '@fontsource-variable/source-serif-4';
import './globals.css';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'Ledger — Company Management',
  description: 'Income, projects and partner profit across every app you run.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#FBFBF9' },
    { media: '(prefers-color-scheme: dark)', color: '#11181F' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-dvh font-sans">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
