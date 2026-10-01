import {
  proxyActivities,
  ApplicationFailure,
  CancellationScope,
  log,
} from '@temporalio/workflow';
import type { TripActivities, Trip } from './activities';

const a = proxyActivities<TripActivities>({
  startToCloseTimeout: '30 seconds',
  retry: { initialInterval: '1 second', maximumAttempts: 3 },
});
// Compensations must eventually succeed: retry them (much) longer
const undo = proxyActivities<TripActivities>({
  startToCloseTimeout: '30 seconds',
  retry: { initialInterval: '1 second', maximumInterval: '1 minute' }, // unlimited
});

export interface Itinerary {
  flight: string;
  hotel: string;
  car: string;
}

// Saga: a "distributed transaction" across three suppliers without 2-phase commit
export async function bookTripWorkflow(trip: Trip): Promise<Itinerary> {
  const compensations: Array<() => Promise<void>> = [];
  try {
    const flight = await a.bookFlight(trip);
    compensations.unshift(() => undo.cancelFlight(flight));

    const hotel = await a.bookHotel(trip);
    compensations.unshift(() => undo.cancelHotel(hotel));

    const car = await a.bookCar(trip);
    compensations.unshift(() => undo.cancelCar(car));

    return { flight, hotel, car };
  } catch (err) {
    log.warn('Trip booking failed, compensating', { steps: compensations.length });
    await CancellationScope.nonCancellable(async () => {
      for (const compensate of compensations) await compensate(); // reverse order
    });
    throw ApplicationFailure.nonRetryable(
      `Trip ${trip.tripId} could not be booked and was rolled back`,
      'TripRolledBack',
    );
  }
}
