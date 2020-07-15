import { google, gmail_v1 } from "googleapis";
import { GaxiosResponse } from "gaxios";
const base64 = require("js-base64").Base64;
import { config } from "./config";
import { ILogger } from "./models";
import { createClient } from "./telegram";
import * as cheerio from "cheerio";
import MailComposer from 'nodemailer/lib/mail-composer';
import { URL } from "url";
import { Apartment, AddressComponents, FullAddress, DirectionsForApartment } from "./types";
import { getMessagesForTravels, findDirectionsForApartments } from "./directions";
import { mapSeriesAsync } from "./util";
import { downloadApartmentPdfs, ApartmentPdfs } from "./scraper";

export async function run(logger: ILogger) {
  const telegramClient = createClient(config.telegramBotToken);

  const { client_secret, client_id, redirect_uris } = config.googleCredentials.installed;
  const oAuth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    redirect_uris[0]
  );

  oAuth2Client.setCredentials(config.googleToken);
  await processUnread(oAuth2Client);

  async function processUnread(auth) {
    // https://googleapis.dev/nodejs/googleapis/latest/gmail/index.html
    const gmail = google.gmail({ version: "v1", auth });
    const res = await gmail.users.messages.list({
      userId: "me",
      labelIds: ["UNREAD"]
    });

    if (!res.data.messages || res.data.messages.length === 0) {
      logger.info("No unread messages");
      return;
    }

    let msgs = await Promise.all<any>(
      res.data.messages.map(listedMsg => {
        const msg = gmail.users.messages.get({
          userId: "me",
          id: listedMsg.id
        });

        return msg;
      })
    );

    const etuoviNewApartmentsForSale = findEtuoviMessages(msgs, /uusi.*asunto/i);
    const etuoviNewShows = findEtuoviMessages(msgs, /asuntoesittely/i);
    if (etuoviNewApartmentsForSale.length === 0 && etuoviNewShows.length === 0) {
      logger.info("No unread etuovi messages");
    }

    const forSale = messagesToAparments(etuoviNewApartmentsForSale);
    const forShow = messagesToAparments(etuoviNewShows);

    if (forSale.length > 0) {
      logger.info("Sending new apartments", forSale.map(apt => apt.url).join(", "));

      const directionsForApartments = await findDirectionsForApartments(forSale);
      await mapSeriesAsync(forSale, async (apartment) => {
        const friendlyAddr = getFriendlyAddress(apartment);
        const startMsg = `<b>New apartment or change at ${friendlyAddr}!</b>\n${apartment.url}`;
        const endMsg = `<b>That's all about ${friendlyAddr}.</b>`;
        await sendApartment(startMsg, endMsg, apartment, directionsForApartments);

        if (config.saveApartmentPdfs) {
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

    await markAsRead(gmail, msgs.map(m => m.data.id));
  }

  // More low-level example here:
  // https://github.com/googleapis/google-api-nodejs-client/blob/ccdbdb7cae64acd6445b9fa20761502d778fd1e3/samples/gmail/send.js
  async function sendPdfs(gmail: gmail_v1.Gmail, apartment: Apartment, pdfs: ApartmentPdfs): Promise<GaxiosResponse<gmail_v1.Schema$Message>> {
    const profile = (await gmail.users.getProfile({ userId: 'me' })).data;
    const aptFileId = apartment.id.replace(/\//g, '');
    const mail = new MailComposer({
      from: `${profile.emailAddress} <${profile.emailAddress}>`,
      to: `${profile.emailAddress} <${profile.emailAddress}>`,
      subject: `PDF files from ${apartment.address}`,
      text: `Etuovi snapshots for ${apartment.url}. Address: ${apartment.address}`,
      textEncoding: 'base64',
      attachments: [
        {
          filename: `apartment-${aptFileId}.pdf`,
          content: pdfs.apartmentPdf.toString('base64'),
          encoding: 'base64'
        },
        {
          filename: `images-${aptFileId}.pdf`,
          content: pdfs.imagesPdf.toString('base64'),
          encoding: 'base64'
        },
        {
          filename: `apartment-${aptFileId}.html`,
          content: pdfs.apartmentHtml,
        },
      ]
    });
    const raw = await mail.compile().build();
    const res = await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: raw.toString('base64'),
      },
    });

    return res;
  }

  async function sendApartment(startMsg: string, endMsg: string, apartment: Apartment, directionsForApartments: DirectionsForApartment[]) {
    const res = await telegramClient.sendMsg(config.telegramBotChannel, startMsg);
    const messageId = res.data.result.message_id;

    const messages = getMessagesForTravels(apartment, directionsForApartments);
    await mapSeriesAsync(messages, async message => {
      await telegramClient.sendMsg(config.telegramBotChannel, message);
    });

    await telegramClient.sendMsg(config.telegramBotChannel, endMsg, messageId);
  }

  function messagesToAparments(msgs: GaxiosResponse<gmail_v1.Schema$Message>[]): Apartment[] {
    return msgs.map(parsePayload)
      .map(parseApartmentsFromEmail)
      .reduce((all, curr) => all.concat(curr), []);
  }

  function markAsRead(gmail: gmail_v1.Gmail, msgIds: string[]) {
    logger.info("Marking as read", msgIds.join(", "));

    return gmail.users.messages.batchModify({
      userId: "me",
      requestBody: {
        ids: msgIds,
        removeLabelIds: ["UNREAD"]
      }
    });
  }

  function findEtuoviMessages(msgs: GaxiosResponse<gmail_v1.Schema$Message>[], subjectPattern: RegExp) {
    return msgs.filter(msg => {
      const fromHeader = getHeader(msg, 'From');
      const isCorrectFrom = fromHeader && fromHeader.includes("@etuovi.com");
      const subjectHeader = getHeader(msg, 'Subject');
      const isCorrectSubject = subjectHeader && subjectPattern.test(subjectHeader);
      return isCorrectFrom && isCorrectSubject;
    });
  }

  function getHeader(msg: GaxiosResponse<gmail_v1.Schema$Message>, name: string): string | undefined {
    const header = msg!.data!.payload!.headers!.find(h => h.name === name);
    return header?.value;
  }

  function parsePayload(msg: GaxiosResponse<gmail_v1.Schema$Message>) {
    const htmlPart = msg!.data!.payload!.parts!.find(
      p => p.mimeType === "text/html"
    );
    if (!htmlPart) {
      return "";
    }

    return base64.decode(
      htmlPart.body!.data!.replace(/-/g, "+").replace(/_/g, "/")
    );
  }
}

interface AddressLink {
  href?: string;
  text: string;
}

export function parseApartmentsFromEmail(html: string): Apartment[] {
  // Uncomment to get test data:
  // require('fs').writeFileSync(`example${(new Date).toISOString()}.html`, html);

  const $ = cheerio.load(html);
  const links: AddressLink[] = [];

  // Typings worked better this way
  $("a").each((i, el) => {
    links.push({
      href: $(el).attr("href"),
      text: $(el).text(),
    });
  });

  const apartments = links
    .filter((link: AddressLink): link is Required<AddressLink> => {
      const isAddress = link.text.endsWith(', Suomi');
      const isCorrectLink = typeof link.href === 'string' && link.href.startsWith("https://www.etuovi.com/kohde/");
      return isCorrectLink && isAddress;
    })
    .map((link) => {
      const u = new URL(link.href);

      const apt: Apartment = {
        id: u.pathname,
        url: u.origin + u.pathname,
        address: link.text,
        addressComponents: parseAddressToComponents(link.text),
      }
      return apt;
    });

  const uniqUrls = Array.from(new Set(apartments.map(apt => apt.url)));
  // Can't be undefined
  return uniqUrls.map(url => apartments.find(apt => apt.url === url)) as Apartment[];
}

function getFriendlyAddress(apartment: Apartment) {
  const street = apartment.addressComponents.street;
  const cityPart = apartment.addressComponents.cityPart;
  return `${street}, ${cityPart}`;
}

// Examples:
// Leikkikuja 4 as 3, 14700, Kirkonkylä, Hämeenlinna, Suomi
// Huvilinnanmäki 8 A, 02600, Leppävaara, Espoo, Suomi
// Kalevanvainio 1 C 16, 02100, Tapiola, Aarnivalkea, Espoo, Suomi
export function parseAddressToComponents(address: FullAddress): AddressComponents {
  const parts = address.split(',');
  const lastIndex = parts.length - 1;
  return {
    street: parts[0].trim(),
    postalCode: parts[1].trim(),
    cityPart: parts[2].trim(),
    // Not sure what "Aarnivalkea" would be
    city: parts[lastIndex - 1].trim(),
    country: parts[lastIndex].trim(),
  };
}
