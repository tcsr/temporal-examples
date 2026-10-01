import { ApplicationFailure } from '@temporalio/activity';

export interface SearchQuery {
  from: string;
  to: string;
  date: string;
  passengers: number;
}
export interface Offer {
  provider: string;
  flight: string;
  priceCents: number;
}

// One airline / aggregator API (Amadeus, Sabre, an airline's own API, ...)
export interface FlightProvider {
  name: string;
  search(q: SearchQuery): Promise<Offer[]>;
}

export function createSearchActivities(providers: FlightProvider[]) {
  const byName = new Map(providers.map((p) => [p.name, p]));
  return {
    // Fast, pure check: run as a *local* activity (no task-queue round trip)
    async validateQuery(q: SearchQuery): Promise<SearchQuery> {
      if (q.from.toUpperCase() === q.to.toUpperCase()) {
        throw ApplicationFailure.nonRetryable(
          'Origin and destination are the same',
          'InvalidQuery',
        );
      }
      if (q.passengers < 1 || q.passengers > 9) {
        throw ApplicationFailure.nonRetryable(
          'Between 1 and 9 passengers allowed',
          'InvalidQuery',
        );
      }
      return { ...q, from: q.from.toUpperCase(), to: q.to.toUpperCase() };
    },

    async searchProvider(name: string, q: SearchQuery): Promise<Offer[]> {
      const provider = byName.get(name);
      if (!provider)
        throw ApplicationFailure.nonRetryable(`Unknown provider ${name}`);
      return provider.search(q);
    },
  };
}

export type SearchActivities = ReturnType<typeof createSearchActivities>;
