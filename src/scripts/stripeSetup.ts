// Creates the plan catalogue in Stripe: one Product per plan + credit volume
// (9), each with a monthly and a yearly Price (18), and a customer portal
// configuration that lets owners switch between them. Uses the current
// prices (admin-edited, or the defaults). Safe to re-run: it reuses what's
// already there and only creates what's missing or changed.
//
//   npm run stripe:setup
//
// Prints the portal configuration id to put in STRIPE_PORTAL_CONFIGURATION.
import "dotenv/config";
import { getPriceTable, syncStripeCatalog } from "../lib/catalog.js";
import { prisma } from "../lib/prisma.js";

const { lines, portalConfigurationId } = await syncStripeCatalog(await getPriceTable());
for (const line of lines) console.log(line);
console.log(`\nPortal configuration: ${portalConfigurationId}`);
console.log(`Set STRIPE_PORTAL_CONFIGURATION=${portalConfigurationId} in .env`);
await prisma.$disconnect();
