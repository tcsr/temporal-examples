import {
  proxyActivities,
  proxyLocalActivities,
  ApplicationFailure,
} from '@temporalio/workflow';
import type { SearchActivities, SearchQuery, Offer } from './activities';

const { validateQuery } = proxyLocalActivities<SearchActivities>({
  startToCloseTimeout: '2 seconds',
});
const { searchProvider } = proxyActivities<SearchActivities>({
  startToCloseTimeout: '5 seconds',
  retry: { maximumAttempts: 2 }, // a slow provider must not stall the search
});

export interface SearchResult {
  cheapest: Offer;
  offersFound: number;
  failedProviders: string[];
}

export async function flightSearchWorkflow(input: {
  query: SearchQuery;
  providers: string[];
}): Promise<SearchResult> {
  const query = await validateQuery(input.query);

  // Fan out: every provider is searched in parallel
  const settled = await Promise.allSettled(
    input.providers.map((name) => searchProvider(name, query)),
  );

  // Fan in: keep what succeeded, remember what failed
  const offers: Offer[] = [];
  const failedProviders: string[] = [];
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled') offers.push(...r.value);
    else failedProviders.push(input.providers[i]);
  });

  if (offers.length === 0) {
    throw ApplicationFailure.nonRetryable(
      'No provider returned offers',
      'NoOffers',
    );
  }
  offers.sort((a, b) => a.priceCents - b.priceCents);
  return { cheapest: offers[0], offersFound: offers.length, failedProviders };
}
