import { run } from "../CheckForNewApartments/logic";
import { createClient } from "../CheckForNewApartments/telegram";
import { config } from "../CheckForNewApartments/config";
import { withClient } from "../CheckForNewApartments/redis";

const telegramClient = createClient(config.telegramBotToken);

withClient(config.redisUrl, (client) => run(console as any, client))
  .catch(async err => {
    const tgMsg = `<b>Error:</b> ${err.message}`;
    await telegramClient.sendMsg(config.telegramBotChannel, tgMsg);

    if (err.response) {
      console.error(err.response.data)
    }

    console.error(err.stack || err.message);
    process.exit(1);
  });
