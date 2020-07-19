import { AzureFunction, Context } from "@azure/functions";
import { run } from "./logic";
import { withClient } from "./redis";
import { config } from "./config";

const timerTrigger: AzureFunction = async function(
  context: Context,
  myTimer: any
): Promise<void> {
  context.log("Running...");

  await withClient(config.redisUrl, (client) => run(context.log, client));

  context.log("Done");
};

export default timerTrigger;
