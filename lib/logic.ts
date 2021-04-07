import { google } from "googleapis";
import { config } from "./config";
import { ILogger } from "./models";
import { createClient, TelegramMessage } from "./telegram";
import { Apartment, DirectionsForApartment, ApartmentId } from "./types";
import {
  getMessagesForTravels,
  findDirectionsForApartment,
} from "./directions";
import { mapSeriesAsync } from "./util";
import { downloadApartmentPdfs } from "./scraper";
// import { findEtuoviMessages, messagesToAparments, getFriendlyAddress, sendPdfs, markAsRead, getMessages } from "./gmail";
import { RedisAbstraction } from "./redis";
