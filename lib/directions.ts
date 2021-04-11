import {
  FullAddress,
  AddressComponents,
  TransitOptions,
  ArrivalTime,
  Apartment,
  DirectionsForPlace,
  DirectionsForApartment,
  FixedRouteLeg,
  FixedDirectionsStep,
  Place,
} from "./types";
import {
  DirectionsResponse,
  Client,
  UnitSystem,
  TransitRoutingPreference,
  TravelMode,
  Status,
} from "@googlemaps/google-maps-services-js";
import { config } from "./config";
import moment from "moment-timezone";
import PLACES from "./places";
import cheerio from "cheerio";
import { mapSeriesAsync, weekDayToIsoWeekday } from "./util";

// Apartment address might have too many components and G maps doesn't recognize the address
// Splitting to components and sending only certain parts help.
async function fetchDirections(
  apartmentAddress: AddressComponents,
  placeAddress: FullAddress,
  transitOptions: TransitOptions
): Promise<DirectionsResponse[]> {
  const client = new Client();

  const responses = await mapSeriesAsync(transitOptions.modes, async (mode) => {
    try {
      return await client.directions({
        params: {
          key: config.googleMapsKey,
          origin: `${apartmentAddress.street}, ${apartmentAddress.postalCode}, ${apartmentAddress.city}`,
          destination: placeAddress,
          units: UnitSystem.metric,
          mode,
          arrival_time: transitOptions.arrivalTime
            ? arrivalTimeToUnix(transitOptions.arrivalTime)
            : undefined,
          transit_mode: transitOptions.transitModes,
          transit_routing_preference: TransitRoutingPreference.fewer_transfers,
          // "Waypoints are only supported for driving, walking and bicycling directions."
          waypoints:
            mode !== TravelMode.transit ? transitOptions.waypoints || [] : [],
        },
      });
    } catch (e) {
      if (e.response && e.response.data) {
        const message = e.response.data.error_message;
        // XXX: How to get logger instance here?
        console.error("Error fetching directions:", message);
      } else {
        console.error("Error fetching directions:", e);
      }

      throw e;
    }
  });

  return responses;
}

function travelModeToLabel(mode: TravelMode): string {
  const labelMap: { [e: string]: string } = {
    // Works in telegram HTML parsing mode
    // For codes see https://emojipedia.org/bicycle/
    // Bike example: code point U+1F6B2 -> &#xF6B2
    [TravelMode.bicycling]: "&#x1F6B2",
    [TravelMode.driving]: "&#x1F697",
    [TravelMode.transit]: "&#x1F68C",
    [TravelMode.walking]: "&#x1F6B6",
  };
  return labelMap[mode.toLowerCase()];
}

function arrivalTimeToUnix(arrivalTime: ArrivalTime): number {
  const wantedDay = weekDayToIsoWeekday(arrivalTime.weekDay);

  let date = moment();
  // if we haven't yet passed the day of the week:
  if (moment().isoWeekday() <= wantedDay) {
    // get this week's instance of that day
    date = date.isoWeekday(wantedDay);
  } else {
    // otherwise, get next week's instance of that day
    date = moment().add(1, "weeks").isoWeekday(wantedDay);
  }

  const arrival = date
    .hour(arrivalTime.hour)
    .minute(arrivalTime.minute)
    .second(0);

  return arrival.unix();
}

async function findDirectionsForPlace(
  apartment: Apartment,
  place: Place
): Promise<DirectionsForPlace> {
  const directions = await fetchDirections(
    apartment.addressComponents,
    place.address,
    place.transitOptions
  );
  return {
    placeId: place.id,
    directionsResponses: directions,
  };
}

export async function findDirectionsForApartment(
  apartment: Apartment
): Promise<DirectionsForApartment> {
  const directionsForPlaces = await mapSeriesAsync(PLACES, (place) =>
    findDirectionsForPlace(apartment, place)
  );
  return {
    apartmentId: apartment.id,
    directionsForPlaces: directionsForPlaces,
  };
}

function getMessageForPlaceTravel(
  apartment: Apartment,
  directionsForPlace: DirectionsForPlace
): string {
  const lines: string[] = [];
  // Can't be undefined
  const place = PLACES.find(
    (p) => p.id === directionsForPlace.placeId
  ) as Place;
  const hasWayPoints =
    place.transitOptions &&
    place.transitOptions.waypoints &&
    place.transitOptions.waypoints.length > 0;
  const wayPointAddition = hasWayPoints
    ? ` via ${place.transitOptions?.waypoints?.length} waypoints`
    : "";
  const niceAddress = `${apartment.addressComponents.street}, ${apartment.addressComponents.cityPart}`;

  const link = formatGoogleMapsLink(
    apartment.addressComponents,
    place.address,
    place.transitOptions
  );

  lines.push(
    `<b>${directionsForPlace.placeId} <a href="${link}">(from ${niceAddress}${wayPointAddition})</a></b>`
  );

  const responses = directionsForPlace.directionsResponses.map(
    (response, index) => {
      return {
        mode: place.transitOptions.modes[index],
        response,
      };
    }
  );

  const firstSuccessRes = responses.filter((r) =>
    isSuccessResponse(r.response)
  )[0];
  if (!firstSuccessRes) {
    lines.push("No routes could be found");
    return lines.join("\n");
  }

  responses.forEach(({ response, mode }) => {
    getMessageLinesForTravelMode(place, mode, response).forEach((line) =>
      lines.push(line)
    );
  });

  return lines.join("\n");
}

function getMessageLinesForTravelMode(
  place: Place,
  mode: TravelMode,
  response: DirectionsResponse
): string[] {
  const lines: string[] = [];

  if (!isSuccessResponse(response) || response.data.routes.length === 0) {
    console.error(response.data);
    lines.push(
      `${travelModeToLabel(mode)} No route found ${
        response.data.error_message || ""
      }`
    );
    return lines;
  }

  const legCount = response.data.routes[0].legs.length;
  const totalSec = response.data.routes[0].legs.reduce(
    (acc, leg) => acc + leg.duration.value,
    0
  );
  const totalMeter = response.data.routes[0].legs.reduce(
    (acc, leg) => acc + leg.distance.value,
    0
  );
  const lineParts = [
    `${travelModeToLabel(mode)} total of `,
    `${formatDuration(totalSec)}, ${formatDistance(totalMeter)} travel`,
    mode === TravelMode.transit &&
    place.transitOptions.waypoints &&
    place.transitOptions.waypoints.length > 0
      ? " <i>(waypoints not supported in transit mode)</i>"
      : "",
    response.data.routes.length > 1
      ? ` (${response.data.routes.length} routes available)`
      : "",
    legCount > 1 ? `. Route with ${legCount} legs:` : "",
  ];
  lines.push(lineParts.join(""));

  return lines;
}

function isSuccessResponse(response: DirectionsResponse): boolean {
  return response.status === 200 && response.data.status === Status.OK;
}

function formatDistance(distanceMeter: number): string {
  if (distanceMeter < 1000) {
    return `${roundToTen(distanceMeter).toFixed(0)} m`;
  }
  return `${(distanceMeter / 1000).toFixed(1)} km`;
}

function roundToTen(val: number): number {
  return Math.round(val / 10) * 10;
}

function formatDuration(durationSec: number): string {
  const hours = Math.floor(durationSec / 3600);
  // Ceil probably doesn't hurt in estimation
  const minutes = Math.ceil((durationSec - hours * 3600) / 60);

  const parts: string[] = [];
  if (hours > 0) {
    parts.push(`${hours.toFixed(0)} h`);
  }
  parts.push(`${minutes.toFixed(0)} min`);
  return parts.join(" ");
}

function formatGoogleMapsLink(
  address1Comp: AddressComponents,
  address2: FullAddress,
  transitOptions: TransitOptions
): string {
  // https://stackoverflow.com/questions/11354211/google-maps-query-parameter-clarification
  // https://developers.google.com/maps/documentation/urls/guide#directions-action
  const waypoints = transitOptions.waypoints || [];

  const address1 = `${address1Comp.street}, ${address1Comp.postalCode} ${address1Comp.city}`;
  return [
    "https://www.google.com/maps/dir/?api=1",
    `&origin=${encodeURIComponent(address1)}`,
    `&destination=${encodeURIComponent(address2)}`,
    waypoints && waypoints.length > 0
      ? `&waypoints=${encodeURIComponent(waypoints.join("|"))}`
      : "",
  ].join("");
}

export function getMessagesForTravels(
  apartment: Apartment,
  directionsForApartments: DirectionsForApartment[]
): string[] {
  const directionsForApt = directionsForApartments.find(
    (d) => apartment.id === d.apartmentId
  );
  if (!directionsForApt) {
    return [];
  }

  return directionsForApt.directionsForPlaces.map((directionsForPlace) => {
    return getMessageForPlaceTravel(apartment, directionsForPlace);
  });
}
