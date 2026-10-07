import 'dotenv/config';
import { MongoClient } from 'mongodb';

const apiBaseUrl = process.env.CALENDAR_SMOKE_API_URL || 'http://127.0.0.1:3002';
const mongoClient = new MongoClient(process.env.MONGODB_URI);

try {
  await mongoClient.connect();
  const masterDb = mongoClient.db(process.env.MASTER_DB_NAME);
  const tenant = await masterDb.collection('sma_client_master').findOne(
    { isActive: true },
    { projection: { botUserId: 1, _id: 0 } },
  );

  if (!tenant?.botUserId) {
    throw new Error('No active tenant is available in the local master database.');
  }

  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  const url = new URL('/web/v1/master-data/calendar/events', apiBaseUrl);
  url.searchParams.set('from', from.toISOString());
  url.searchParams.set('to', to.toISOString());

  const response = await fetch(url, {
    headers: { 'x-bot-user-id': tenant.botUserId },
  });
  const body = await response.json();

  if (!response.ok) {
    throw new Error(`Calendar API returned ${response.status}: ${body?.message || 'Unknown error'}`);
  }

  const events = Array.isArray(body?.data?.events) ? body.data.events : [];
  console.log(JSON.stringify({
    httpStatus: response.status,
    apiStatus: body.status,
    range: body.data?.range ?? null,
    summary: body.data?.summary ?? null,
    eventCount: events.length,
    eventTypes: [...new Set(events.map((event) => event.eventType))],
  }, null, 2));
} finally {
  await mongoClient.close();
}
