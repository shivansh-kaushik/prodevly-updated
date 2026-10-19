import type { AnyContentDTO, ContentType, DeveloperDTO, PartnerDTO, PricingPlanDTO, ServiceDTO, ShowcaseDTO } from '@/lib/content/types';
import type { SessionUser } from '@/types/session';
import { listContent } from '@/services/content.service';
import { getSettings } from '@/services/settings.service';
import { DeveloperForm } from './developer-form';
import { PartnerForm } from './partner-form';
import { PricingForm } from './pricing-form';
import { ServiceForm } from './service-form';
import { ShowcaseForm } from './showcase-form';

/**
 * Picks the editor for a content type and loads what only the server can supply (the services to
 * tag a project with, the currencies the organisation has enabled). `item` is absent for "new".
 */
export async function EditorFor({ viewer, type, item, readOnlyReason }: { viewer: SessionUser; type: ContentType; item?: AnyContentDTO; readOnlyReason?: string }) {
  switch (type) {
    case 'showcase': {
      const services = await listContent(viewer, 'services', { statuses: ['draft', 'published'] });
      return (
        <ShowcaseForm
          item={item as ShowcaseDTO | undefined}
          serviceOptions={services.map((s) => ({ id: s.id, title: s.title }))}
          canLinkProject={viewer.capabilities.has('project:view')}
          readOnlyReason={readOnlyReason}
        />
      );
    }
    case 'partners':
      return <PartnerForm item={item as PartnerDTO | undefined} readOnlyReason={readOnlyReason} />;
    case 'services':
      return <ServiceForm item={item as ServiceDTO | undefined} readOnlyReason={readOnlyReason} />;
    case 'pricing': {
      const { enabledCurrencies } = await getSettings();
      return <PricingForm item={item as PricingPlanDTO | undefined} currencies={enabledCurrencies} readOnlyReason={readOnlyReason} />;
    }
    case 'developers':
      return <DeveloperForm item={item as DeveloperDTO | undefined} canLinkAccount={viewer.capabilities.has('team:view')} readOnlyReason={readOnlyReason} />;
  }
}
