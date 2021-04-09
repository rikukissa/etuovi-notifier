import axios, { AxiosResponse } from "axios";

export type TelegramClient = ReturnType<typeof createClient>;
// https://core.telegram.org/bots/api#message

export interface TelegramResponse<T> {
  ok: boolean;
  result: T;
}

export interface TelegramMessage {
  // Integer. Unique message identifier inside this chat.
  message_id: number;
  // Optional. For text messages, the actual UTF-8 text of the message, 0-4096 characters
  text: string;
  [key: string]: any;
}

export const createClient = (token: string) => ({
  sendMsg: async function sendMsg(
    chatId: string,
    msg: string,
    replyToId?: number,
    opts: object = {}
  ): Promise<AxiosResponse<TelegramResponse<TelegramMessage>>> {
    const res = await axios({
      method: "post",
      url: `https://api.telegram.org/bot${token}/sendMessage`,
      params: {
        chat_id: chatId,
        // Using HTML mode since MarkdownV2 required espace chars for everything:
        //   Bad Request: can\'t parse entities: Character \'.\' is reserved and must
        //   be escaped with the preceding \'\\\''"
        // https://core.telegram.org/bots/api#html-style
        parse_mode: "HTML",
        text: msg,
        reply_to_message_id: String(replyToId),
        ...opts,
      },
    });
    return res;
  },
});
