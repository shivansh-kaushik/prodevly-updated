import { Home } from '@/components/home/home';
import { loadHomeContent } from '@/lib/content/home-loader';

/** Static, refreshed hourly and on demand when content changes (docs/plan/engineering.html section 2). */
export const revalidate = 3600;

export default async function HomePage() {
  return <Home content={await loadHomeContent()} />;
}
