// hold pays due bills on its own once a day, the way a finance team runs payments.
import { cronJobs } from "convex/server";
import { internal } from "./_generated/api.js";

const crons = cronJobs();

// 16:00 UTC is 9 AM in San Francisco (8 AM in winter).
crons.daily("payment run", { hourUTC: 16, minuteUTC: 0 }, internal.app.increase.dailyPaymentRun);

// 10:00 UTC, before the working day: Apify looks for newly registered look-alikes of supplier domains.
crons.daily("look-alike watch", { hourUTC: 10, minuteUTC: 0 }, internal.app.watch.startWatch);

export default crons;
