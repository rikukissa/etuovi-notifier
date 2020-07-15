import { run } from "../CheckForNewApartments/logic";
import { createClient } from "../CheckForNewApartments/telegram";
import { config } from "../CheckForNewApartments/config";

const telegramClient = createClient(config.telegramBotToken);

run(console as any)
  .catch(async err => {
    const tgMsg = `<b>Error:</b> ${err.message}`;
    await telegramClient.sendMsg(config.telegramBotChannel, tgMsg);

    if (err.response) {
      console.error(err.response.data)
    }

    console.error(err.stack || err.message);
    process.exit(1);
  });
