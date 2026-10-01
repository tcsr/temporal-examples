import { ApplicationFailure } from '@temporalio/activity';

export interface Trip {
  tripId: string;
  traveller: string;
  from: string;
  to: string;
  nights: number;
}

export interface Supplier {
  book(trip: Trip): Promise<string>; // returns a confirmation code
  cancel(confirmation: string): Promise<void>;
}

export class SoldOutError extends Error {}

export function createTripActivities(suppliers: {
  flights: Supplier;
  hotels: Supplier;
  cars: Supplier;
}) {
  const book = async (kind: keyof typeof suppliers, trip: Trip) => {
    try {
      return await suppliers[kind].book(trip);
    } catch (err) {
      if (err instanceof SoldOutError) {
        // retrying won't create inventory
        throw ApplicationFailure.nonRetryable(err.message, 'SoldOut');
      }
      throw err;
    }
  };
  return {
    bookFlight: (trip: Trip) => book('flights', trip),
    bookHotel: (trip: Trip) => book('hotels', trip),
    bookCar: (trip: Trip) => book('cars', trip),
    cancelFlight: (code: string) => suppliers.flights.cancel(code),
    cancelHotel: (code: string) => suppliers.hotels.cancel(code),
    cancelCar: (code: string) => suppliers.cars.cancel(code),
  };
}

export type TripActivities = ReturnType<typeof createTripActivities>;
