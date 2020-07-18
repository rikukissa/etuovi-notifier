import { google } from "googleapis";
import { config } from "./config";
import { ILogger } from "./models";
import { createClient } from "./telegram";
import { Apartment, DirectionsForApartment } from "./types";
import { getMessagesForTravels, findDirectionsForApartments } from "./directions";
import { mapSeriesAsync } from "./util";
import { downloadApartmentPdfs } from "./scraper";
import { findEtuoviMessages, messagesToAparments, getFriendlyAddress, sendPdfs, markAsRead, getMessages } from "./gmail";

export async function run(logger: ILogger) {
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

      // TODO: Make method only for singular object and use apts.map(findDirections)
      const directionsForApartments = await findDirectionsForApartments(forSale);
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

      const directionsForApartments = await findDirectionsForApartments(forShow);
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
    const res = await telegramClient.sendMsg(config.telegramBotChannel, startMsg);
    const messageId = res.data.result.message_id;

    // Uncomment if you want to disable travel information sending for already sent
    // apartments. This would be more useful if we had the previous telegram message id
    // about the apartment, so it could be a reply to that. Unfortunately telegram bots
    // can't access the message history. getUpdates only returns the messages from last 24 hours.
    /*
    const alreadySent = await hasTravelsBeenSent(apartment);
    if (alreadySent) {
      logger.info('Aparment has been already sent');
      return
    }
    */

    const messages = getMessagesForTravels(apartment, directionsForApartments);
    await mapSeriesAsync(messages, async message => {
      await telegramClient.sendMsg(config.telegramBotChannel, message);
    });

    await telegramClient.sendMsg(config.telegramBotChannel, endMsg, messageId);
  }
}
