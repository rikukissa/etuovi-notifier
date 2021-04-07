import { VercelRequest, VercelResponse } from "@vercel/node";
import { gmail } from "googleapis/build/src/apis/gmail";
import { config } from "../lib/config";
import {
  findDirectionsForApartment,
  getMessagesForTravels,
} from "../lib/directions";
import { parseApartmentsFromEmail } from "../lib/gmail";
import { withClient } from "../lib/redis";
import { createClient, TelegramMessage } from "../lib/telegram";
import { Apartment, DirectionsForApartment } from "../lib/types";
import { mapSeriesAsync } from "../lib/util";

export default async (request: VercelRequest, response: VercelResponse) => {
  const apartments = parseApartmentsFromEmail(request.body.plain);

  const forSale = request.body.headers.subject.match(/uusi.*asunto/i);
  const forShow = request.body.headers.subject.match(/asuntoesittely/i);

  if (forSale) {
    const directionsForApartments = await mapSeriesAsync(
      apartments,
      findDirectionsForApartment
    );
    await mapSeriesAsync(apartments, async (apartment) => {
      const replyToId = (await findPreviousMessage(apartment))?.message_id;
      const friendlyAddr = getFriendlyAddress(apartment);
      const startMsg = replyToId
        ? `<b>Something changed at ${friendlyAddr}!</b>`
        : `<b>New apartment at ${friendlyAddr}!</b>\n${apartment.url}`;
      const endMsg = `<b>That's all about ${friendlyAddr}.</b>`;
      await sendApartment(
        startMsg,
        endMsg,
        apartment,
        directionsForApartments,
        replyToId
      );
    });
  }

  if (forShow) {
    const directionsForApartments = await mapSeriesAsync(
      forShow,
      findDirectionsForApartment
    );
    await mapSeriesAsync(apartments, async (apartment) => {
      const replyToId = (await findPreviousMessage(apartment))?.message_id;
      const friendlyAddr = getFriendlyAddress(apartment);
      const startMsg = replyToId
        ? `<b>There will be an apartment showing soon at ${friendlyAddr}.</b>`
        : `<b>There will be an apartment showing soon at ${friendlyAddr}.</b>\n${apartment.url}`;
      const endMsg = `<b>That's all about ${friendlyAddr}. Check out the showing times via Etuovi.</b>`;
      await sendApartment(
        startMsg,
        endMsg,
        apartment,
        directionsForApartments,
        replyToId
      );
    });
  }

  response.status(200).send({});
};

async function findPreviousMessage(
  apartment: Apartment
): Promise<TelegramMessage | undefined> {
  return withClient(config.redisUrl, async (redisClient) => {
    const message = await redisClient.findMessage(
      new RegExp(`${apartment.url}`)
    );
    return message;
  });
}

async function sendApartment(
  startMsg: string,
  endMsg: string,
  apartment: Apartment,
  directionsForApartments: DirectionsForApartment[],
  replyToId?: number
) {
  const telegramClient = createClient(config.telegramBotToken);
  return withClient<void>(config.redisUrl, async (redisClient) => {
    const startRes = await telegramClient.sendMsg(
      config.telegramBotChannel,
      startMsg,
      replyToId
    );
    await redisClient.saveMessage(startRes.data.result);
    const messageId = startRes.data.result.message_id;

    if (replyToId) {
      return;
    }

    const messages = getMessagesForTravels(apartment, directionsForApartments);
    await mapSeriesAsync(messages, async (message) => {
      const travelRes = await telegramClient.sendMsg(
        config.telegramBotChannel,
        message
      );
      await redisClient.saveMessage(travelRes.data.result);
    });

    const endRes = await telegramClient.sendMsg(
      config.telegramBotChannel,
      endMsg,
      messageId
    );
    await redisClient.saveMessage(endRes.data.result);
  });
}

export function getFriendlyAddress(apartment: Apartment) {
  const street = apartment.addressComponents.street;
  const cityPart = apartment.addressComponents.cityPart;
  return `${street}, ${cityPart}`;
}
