
import fetch from 'node-fetch';
import { Apartment } from "./types";
import { config } from "./config";

// Use https://github.com/alvarcarto/url-to-pdf-api for downloading.
// Raw GET request didn't show the content, so JS rendering was needed.
async function downloadPdf(pageUrl: string): Promise<Buffer> {
  const params = new URLSearchParams({
    output: 'pdf',
    emulateScreenMedia: 'false',
    url: pageUrl,
  }).toString();
  const response = await fetch(`${config.pdfApiUrl}/api/render?${params}`, {
    headers: {
      'x-api-key': config.pdfApiToken,
    },
  });
  const buf = await response.buffer();
  return buf;
}

async function downloadHtml(pageUrl: string): Promise<string> {
  const params = new URLSearchParams({
    output: 'html',
    emulateScreenMedia: 'false',
    scrollPage: 'true',
    url: pageUrl,
  }).toString();
  const response = await fetch(`${config.pdfApiUrl}/api/render?${params}`, {
    headers: {
      'x-api-key': config.pdfApiToken,
    },
  });
  const buf = await response.buffer();
  return buf.toString('utf8');
}

export type ApartmentPdfs = {
  apartmentPdf: Buffer;
  apartmentHtml: string;
  imagesPdf: Buffer;
};

export async function downloadApartmentPdfs(apartment: Apartment): Promise<ApartmentPdfs> {
  const apartmentPdf = await downloadPdf(apartment.url);
  const apartmentHtml = await downloadHtml(apartment.url);
  const imagesPdf = await downloadPdf(`${apartment.url}/kuvat`);

  // Uncomment for debug:
  // require('fs').writeFileSync('apartment.pdf', apartmentPdf);
  // require('fs').writeFileSync('apartment.html', apartmentHtml);
  // require('fs').writeFileSync('images.pdf', imagesPdf);

  return {
    apartmentPdf,
    apartmentHtml,
    imagesPdf,
  };
}
