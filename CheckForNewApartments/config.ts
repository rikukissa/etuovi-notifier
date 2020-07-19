import { Base64 as base64 } from "js-base64";

function assertEnvVar(name: string): string {
  if (!process.env[name]) {
    throw new Error(`Missing ${name} env var`);
  }

  return process.env[name]!;
}

const googleCredentials = JSON.parse(base64.decode(assertEnvVar("CREDENTIALS")));
const googleToken = JSON.parse(base64.decode(assertEnvVar("ACCESS_TOKEN")));
const telegramBotToken = assertEnvVar("TELEGRAM_BOT_TOKEN");
const telegramBotChannel = assertEnvVar("TELEGRAM_BOT_CHANNEL");
const googleMapsKey = assertEnvVar("GOOGLE_MAPS_KEY");
const redisUrl = assertEnvVar("REDIS_URL");
const saveApartmentPdfs = process.env.SAVE_APARTMENT_PDFS === "true";

let pdfApiUrl;
let pdfApiToken;
if (saveApartmentPdfs) {
  pdfApiToken = assertEnvVar("PDF_API_TOKEN");
  pdfApiUrl = assertEnvVar("PDF_API_URL");
  if (pdfApiUrl.endsWith('/')) {
    throw new Error('PDF_API_URL should not have a trailing slash');
  }
}

export const config = {
  telegramBotToken,
  telegramBotChannel,
  googleCredentials,
  googleToken,
  googleMapsKey,
  saveApartmentPdfs,
  pdfApiUrl,
  pdfApiToken,
  redisUrl,
};
