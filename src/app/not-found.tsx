import type { Metadata } from 'next';
import { KeyLink } from '@/components/home/key';
import { siteFontClasses } from '@/lib/site-fonts';
import '@/app/(site)/keycap.css';

export const metadata: Metadata = { title: 'Page not found', robots: { index: false } };

/** The site-wide 404, in the colourway: one key that leads back to the start. */
export default function NotFound() {
  return (
    <main className={`pd-site ${siteFontClasses} grid min-h-svh place-items-center bg-cobalt px-4 text-chalk`}>
      <div className="flex max-w-[36rem] flex-col items-start gap-6">
        <p className="pd-kicker">404</p>
        <h1 className="pd-display text-[clamp(2.4rem,9vw,4.4rem)]">This key does nothing.</h1>
        <p className="text-lg leading-relaxed">The page you were looking for is not here. It may have moved, or the link may be wrong.</p>
        <KeyLink href="/" enter className="text-base" style={{ padding: '1em 1.8em' }}>
          Back to the start
        </KeyLink>
      </div>
    </main>
  );
}
