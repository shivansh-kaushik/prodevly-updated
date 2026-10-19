import type { Metadata } from 'next';
import '@fontsource-variable/ibm-plex-sans/wght.css';
import '@fontsource-variable/source-serif-4/wght.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';

export const metadata: Metadata = {
  title: { default: 'Admin', template: '%s | ProDevly Admin' },
  robots: { index: false, follow: false },
};

// Every admin screen reads the signed-in person and live money: never prerender or cache.
export const dynamic = 'force-dynamic';

export default function AdminRootLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="pd-admin" data-ui="admin">
      {children}
    </div>
  );
}
