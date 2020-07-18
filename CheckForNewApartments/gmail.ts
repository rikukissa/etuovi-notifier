import { Apartment, AddressComponents, FullAddress } from "./types";
import { GaxiosResponse } from "gaxios";
import { Base64 as base64 } from "js-base64";
import cheerio from "cheerio";
import MailComposer from "nodemailer/lib/mail-composer";
import { gmail_v1 } from "googleapis";
import { ApartmentPdfs } from "./scraper";
import { mapSeriesAsync } from "./util";

// More low-level example here:
// https://github.com/googleapis/google-api-nodejs-client/blob/ccdbdb7cae64acd6445b9fa20761502d778fd1e3/samples/gmail/send.js
export async function sendPdfs(gmail: gmail_v1.Gmail, apartment: Apartment, pdfs: ApartmentPdfs): Promise<GaxiosResponse<gmail_v1.Schema$Message>> {
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

export function messagesToAparments(msgs: GaxiosResponse<gmail_v1.Schema$Message>[]): Apartment[] {
  return msgs.map(parsePayload)
    .map(parseApartmentsFromEmail)
    .reduce((all, curr) => all.concat(curr), []);
}

export function markAsRead(gmail: gmail_v1.Gmail, msgIds: string[]) {
  return gmail.users.messages.batchModify({
    userId: "me",
    requestBody: {
      ids: msgIds,
      removeLabelIds: ["UNREAD"]
    }
  });
}

export function findEtuoviMessages(msgs: GaxiosResponse<gmail_v1.Schema$Message>[], subjectPattern: RegExp) {
  return msgs.filter(msg => {
    const fromHeader = getHeader(msg, 'From');
    const isCorrectFrom = fromHeader && fromHeader.includes("@etuovi.com");
    const subjectHeader = getHeader(msg, 'Subject');
    const isCorrectSubject = subjectHeader && subjectPattern.test(subjectHeader);
    return isCorrectFrom && isCorrectSubject;
  });
}

type RequiredBy<T, K extends keyof T> = Required<T> & Pick<T, K>;
type Schema$MessageWithRequiredId = RequiredBy<gmail_v1.Schema$Message, 'id'>


export async function getMessages(gmail: gmail_v1.Gmail, options: gmail_v1.Params$Resource$Users$Messages$List = {}): Promise<GaxiosResponse<Schema$MessageWithRequiredId>[]> {
  const res = await gmail.users.messages.list(Object.assign({
    userId: "me",
    maxResults: 100,
  }, options));

  if (!res.data.messages || res.data.messages.length === 0) {
    return [];
  }

  const msgs = await mapSeriesAsync(res.data.messages, async listedMsg => {
    if (!listedMsg.id) {
      return undefined;
    }

    const msg = await gmail.users.messages.get({
      userId: "me",
      id: listedMsg.id
    });

    return msg;
  });

  return msgs.filter((msg): msg is GaxiosResponse<Schema$MessageWithRequiredId> => msg !== undefined);
}

function getHeader(msg: GaxiosResponse<gmail_v1.Schema$Message>, name: string): string | undefined {
  const header = msg!.data!.payload!.headers!.find(h => h.name === name);
  return header?.value;
}

export function parsePayload(msg: GaxiosResponse<gmail_v1.Schema$Message>) {
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

export function getFriendlyAddress(apartment: Apartment) {
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
