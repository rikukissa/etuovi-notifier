import { TravelMode, TransitMode } from "@googlemaps/google-maps-services-js";
import { Place, ArrivalTime } from "./types";

const workStart: ArrivalTime = { weekDay: "Monday", hour: 9, minute: 0 };
const hobbyStart: ArrivalTime = { weekDay: "Tuesday", hour: 19, minute: 0 };

const PLACES: Place[] = [
  {
    id: "Lentokenttä",
    address: "Helsinki Airport",
    transitOptions: {
      modes: [TravelMode.transit],
    },
  },
  {
    id: "Tieto",
    address: "Keilalahdentie 2-4, 02150 Espoo",
    transitOptions: {
      arrivalTime: workStart,
      modes: [TravelMode.transit, TravelMode.bicycling],
    },
  },
  {
    id: "Mallan tanssit",
    address: "Ruoholahti",
    transitOptions: {
      arrivalTime: hobbyStart,
      modes: [TravelMode.transit],
      transitModes: [TransitMode.bus],
    },
  },
];

export default PLACES;
