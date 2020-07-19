import { google } from "googleapis";
import { config } from "./config";
import { ILogger } from "./models";
import { createClient } from "./telegram";
import { Apartment, DirectionsForApartment } from "./types";
import { getMessagesForTravels, findDirectionsForApartment } from "./directions";
import { mapSeriesAsync } from "./util";
import { downloadApartmentPdfs } from "./scraper";
import { findEtuoviMessages, messagesToAparments, getFriendlyAddress, sendPdfs, markAsRead, getMessages } from "./gmail";
import { RedisAbstraction } from "./redis";

export async function run(logger: ILogger, redisClient: RedisAbstraction) {
  const { client_secret, client_id, redirect_uris } = config.googleCredentials.installed;
  const oAuth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    redirect_uris[0]
  );

  const telegramClient = createClient(config.telegramBotToken);
  oAuth2Client.setCredentials(config.googleToken);
  // https://googleapis.dev/nodejs/googleapis/latest/gmail/index.html
  const gmail = google.gmail({ version: "v1", auth: oAuth2Client });

  await processUnread();

  async function processUnread() {
    const unreadMessages = await getMessages(gmail, { labelIds: ["UNREAD"] });
    const etuoviNewApartmentsForSale = findEtuoviMessages(unreadMessages, /uusi.*asunto/i);
    const etuoviNewShows = findEtuoviMessages(unreadMessages, /asuntoesittely/i);
    if (etuoviNewApartmentsForSale.length === 0 && etuoviNewShows.length === 0) {
      logger.info("No unread etuovi messages");
      return;
    }

    const forSale = messagesToAparments(etuoviNewApartmentsForSale);
    const forShow = messagesToAparments(etuoviNewShows);

    if (forSale.length > 0) {
      logger.info("Sending new apartments", forSale.map(apt => apt.url).join(", "));

      const directionsForApartments = await mapSeriesAsync(forSale, findDirectionsForApartment);
      await mapSeriesAsync(forSale, async (apartment) => {
        const friendlyAddr = getFriendlyAddress(apartment);
        const startMsg = `<b>New apartment or change at ${friendlyAddr}!</b>\n${apartment.url}`;
        const endMsg = `<b>That's all about ${friendlyAddr}.</b>`;
        await sendApartment(startMsg, endMsg, apartment, directionsForApartments);

        if (config.saveApartmentPdfs) {
          logger.info("Saving PDF snapshots ..");
          const pdfs = await downloadApartmentPdfs(apartment);
          await sendPdfs(gmail, apartment, pdfs);
        }
      });
    }

    if (forShow.length > 0) {
      logger.info("Sending new shows", forShow.map(apt => apt.url).join(", "));

      const directionsForApartments = await mapSeriesAsync(forShow, findDirectionsForApartment);
      await mapSeriesAsync(forShow, async apartment => {
        const friendlyAddr = getFriendlyAddress(apartment);
        const startMsg = `<b>There will be an apartment showing soon at ${friendlyAddr}.</b>\n${apartment.url}`;
        const endMsg = `<b>That's all about ${friendlyAddr}. Check out the showing times via Etuovi.</b>`;
        await sendApartment(startMsg, endMsg, apartment, directionsForApartments);
      });
    }
    const msgIds = unreadMessages.map(m => m.data.id);
    logger.info("Marking as read", msgIds.join(", "));
    await markAsRead(gmail, msgIds);
  }

  async function hasTravelsBeenSent(apartment: Apartment) {
    const prevMessages = await getMessages(gmail, { q: 'is:read' });
    const prevApartmentMessages = findEtuoviMessages(prevMessages, /uusi.*asunto/i)
      .concat(findEtuoviMessages(prevMessages, /asuntoesittely/i));

    const prevApartments = messagesToAparments(prevApartmentMessages);
    const prevApt = prevApartments.find(prev => prev.id === apartment.id);
    return prevApt !== undefined;
  }

  async function sendApartment(startMsg: string, endMsg: string, apartment: Apartment, directionsForApartments: DirectionsForApartment[]) {
    const replyTo = await redisClient.findMessage(new RegExp(`${apartment.url}`));
    const replyToId = replyTo?.message_id
    const startRes = await telegramClient.sendMsg(config.telegramBotChannel, startMsg, replyToId);
    await redisClient.saveMessage(startRes.data.result);
    const messageId = startRes.data.result.message_id;

    if (replyTo) {
      return;
    }

    const messages = getMessagesForTravels(apartment, directionsForApartments);
    await mapSeriesAsync(messages, async message => {
      const travelRes = await telegramClient.sendMsg(config.telegramBotChannel, message);
      await redisClient.saveMessage(travelRes.data.result);
    });

    const endRes = await telegramClient.sendMsg(config.telegramBotChannel, endMsg, messageId);
    await redisClient.saveMessage(endRes.data.result);
  }
}
