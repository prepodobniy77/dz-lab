type Placement = 'catalog-top' | 'catalog-bottom';

type Campaign = {
  title: string;
  description: string;
  href: `https://${string}`;
};

// Add a campaign under a placement key to show it on the site.
const campaigns: Partial<Record<Placement, Campaign>> = {};

export function AdPlacement({ placement }: { placement: Placement }) {
  const campaign = campaigns[placement];
  if (!campaign) return null;

  return (
    <aside className="ad-placement" aria-label="Реклама" data-placement={placement}>
      <div>
        <span className="ad-placement-label">Реклама</span>
        <h2>{campaign.title}</h2>
        <p>{campaign.description}</p>
      </div>
      <a className="subtle-button" href={campaign.href} rel="sponsored">
        Подробнее
      </a>
    </aside>
  );
}
