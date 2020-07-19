import yesno from 'yesno';
import { config } from "../CheckForNewApartments/config";
import { withClient } from "../CheckForNewApartments/redis";

withClient(config.redisUrl, async (client) => {
  const res = await client.redis.lrange('messages', 0, -1);
  if (res.length === 0) {
    console.log('No messages found.');
    return;
  }
  console.log(`About to delete following messages:\n${res.join('\n\n')}`);

  const ok = await yesno({
    question: 'Are you sure you want to continue? (y/N)',
    defaultValue: false,
  });
  if (!ok) {
    console.log('Ok. Not deleting messages.');
    return;
  }
  await client.redis.del('messages');
  console.log(`Deleted ${res.length} messages`);
})
  .catch(async err => {
    if (err.response) {
      console.error(err.response.data)
    }

    console.error(err.stack || err.message);
    process.exit(1);
  });
