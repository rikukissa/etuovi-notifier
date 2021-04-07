import Redis from "ioredis";
import { TelegramMessage } from "./telegram";

export interface RedisAbstraction {
  redis: Redis.Redis;
  saveMessage: (message: TelegramMessage) => Promise<void>;
  findMessage: (pattern: RegExp) => Promise<TelegramMessage | undefined>;
}

export async function withClient<T>(
  connectionUrl: string,
  cb: (client: RedisAbstraction) => Promise<T>
) {
  const redis = new Redis(connectionUrl);

  const client = {
    redis,
    saveMessage: async function saveMessage(message: TelegramMessage) {
      await redis.rpush("messages", JSON.stringify(message));
    },
    findMessage: async function findMessage(
      pattern: RegExp
    ): Promise<TelegramMessage | undefined> {
      const res = await redis.lrange("messages", 0, -1);
      const messages = res.map((str) => JSON.parse(str)) as TelegramMessage[];
      return messages.find((message) => {
        const textOneLine = message.text.split("\n").join(" ");
        return pattern.test(textOneLine);
      });
    },
  };

  const res = await cb(client);
  await redis.disconnect();
  return res;
}
