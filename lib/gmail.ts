import { Apartment, AddressComponents, FullAddress } from "./types";
import cheerio from "cheerio";

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
      const isAddress = link.text.endsWith(", Suomi");
      const isCorrectLink =
        typeof link.href === "string" &&
        link.href.startsWith("https://www.etuovi.com/kohde/");
      return isCorrectLink && isAddress;
    })
    .map((link) => {
      const u = new URL(link.href);

      const apt: Apartment = {
        id: u.pathname,
        url: u.origin + u.pathname,
        address: link.text,
        addressComponents: parseAddressToComponents(link.text),
      };
      return apt;
    });

  const uniqUrls = Array.from(new Set(apartments.map((apt) => apt.url)));
  // Can't be undefined
  return uniqUrls.map((url) =>
    apartments.find((apt) => apt.url === url)
  ) as Apartment[];
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
export function parseAddressToComponents(
  address: FullAddress
): AddressComponents {
  const parts = address.split(",");
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
