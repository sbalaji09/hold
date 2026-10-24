// hold pays due bills on its own once a day, the way a finance team runs payments.
import { cronJobs } from "convex/server";
import { internal } from "./_generated/api.js";

const crons = cronJobs();

// 16:00 UTC is 9 AM in San Francisco (8 AM in winter).
crons.daily("payment run", { hourUTC: 16, minuteUTC: 0 }, internal.app.increase.dailyPaymentRun);

export default crons;
