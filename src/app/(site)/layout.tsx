import { SmoothScroll } from '@/components/site/smooth-scroll';
import { siteFontClasses } from '@/lib/site-fonts';
import './site.css';
import './keycap.css';

/**
 * The public site's layout: the one clock and scroll input for every public page, and
 * the Keycap Colorway's faces (`src/lib/site-fonts.ts`). The 3D stage is NOT mounted
 * here; a page mounts it (StageMount), so only pages with stations ever load three.js,
 * and admin routes (outside this group) ship none of it.
 */
export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <SmoothScroll>
      <div className={`pd-site ${siteFontClasses}`}>{children}</div>
    </SmoothScroll>
  );
}
