import { VercelRequest, VercelResponse } from "@vercel/node";

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

const telegramClient = createClient(config.telegramBotToken);
export default async (request: VercelRequest, response: VercelResponse) => {
  try {
    const res = handler(request, response);
    return res;
  } catch (error) {
    await telegramClient.sendMsg(
      config.telegramBotChannel,
      error.message,
      undefined,
      { disable_web_page_preview: true }
    );
  }
};

const handler = async (request: VercelRequest, response: VercelResponse) => {
  const forSale = request.body.headers.subject.match(/uusi.*asunto/i);
  const forShow = request.body.headers.subject.match(/asuntoesittely/i);

  if (forSale) {
    const apartments = parseApartmentsFromEmail(request.body.html);
    const directionsForApartments = await mapSeriesAsync(
      apartments,
      findDirectionsForApartment
    );
    await mapSeriesAsync(apartments, async (apartment) => {
      const replyToId = undefined; //(await findPreviousMessage(apartment))?.message_id;
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
  } else if (forShow) {
    const apartments = parseApartmentsFromEmail(request.body.html);
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
  } else {
    try {
      await telegramClient.sendMsg(
        config.telegramBotChannel,
        request.body.html
      );
    } catch (error) {
      await telegramClient.sendMsg(
        config.telegramBotChannel,
        "Odottamaton sähköposti, jota ei saatu käsiteltyä"
      );
    }
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
  const directions = getMessagesForTravels(
    apartment,
    directionsForApartments
  ).join("\n\n");

  return telegramClient.sendMsg(
    config.telegramBotChannel,
    startMsg + "\n" + directions,
    replyToId
  );
}

export function getFriendlyAddress(apartment: Apartment) {
  const street = apartment.addressComponents.street;
  const cityPart = apartment.addressComponents.cityPart;
  return `${street}, ${cityPart}`;
}
