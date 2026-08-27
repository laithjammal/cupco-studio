import type { Metadata } from 'next';
// The @fontsource stylesheets register the SAME font files that opentype.js
// outlines for export, so preview and print file cannot disagree.
import '@fontsource/inter/400.css';
import '@fontsource/inter/700.css';
import '@fontsource/montserrat/400.css';
import '@fontsource/montserrat/700.css';
import '@fontsource/oswald/400.css';
import '@fontsource/oswald/700.css';
import '@fontsource/bebas-neue/400.css';
import '@fontsource/playfair-display/400.css';
import '@fontsource/playfair-display/700.css';
import '@fontsource/roboto-slab/400.css';
import '@fontsource/roboto-slab/700.css';
import './globals.css';

export const metadata: Metadata = {
  title: 'Cupco Studio',
  description: 'Cup mockup and production studio, on one shared geometry engine',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
