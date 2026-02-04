import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import Parser from 'rss-parser';

const s3 = new S3Client({
  region: process.env.AWS_REGION ?? "us-east-1",
});
const parser = new Parser();
const BUCKET_NAME = "andres-morales-portfolio";

const FEEDS = [
  { name: 'Cursor', url: 'https://any-feeds.com/api/feeds/custom/cmkoaiogm0000lf04qmtirq2g/rss.xml' },
  { name: 'InfoQ', url: 'https://feed.infoq.com/' },
  { name: 'HackerNews', url: 'https://news.ycombinator.com/rss' }
];

const FEED_TIMEOUT_MS = 5000; // 5 seconds per feed

async function fetchWithTimeout(
  feed: { name: string; url: string },
  timeoutMs: number = FEED_TIMEOUT_MS
): Promise<Array<{ source: string; title?: string; link?: string; date: number }>> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`Timeout: ${feed.name} took too long`)), timeoutMs)
  );

  const fetchPromise = parser.parseURL(feed.url).then((res) =>
    res.items.slice(0, 3).map((item) => {
      const result: { source: string; title?: string; link?: string; date: number } = {
        source: feed.name,
        date: item.pubDate ? new Date(item.pubDate).getTime() : Date.now(),
      };
      if (item.title) result.title = item.title;
      if (item.link) result.link = item.link;
      return result;
    })
  );

  try {
    return await Promise.race([fetchPromise, timeout]);
  } catch (e) {
    console.error(`Feed ${feed.name} failed or timed out:`, e);
    return [];
  }
}

export const handler = async () => {
  const today = new Date().toISOString().split('T')[0];
  const fileKey = `news-cache/${today}.json`;

  try {
    // 1. Check if S3 already has today's "baked" JSON
    const getCommand = new GetObjectCommand({ Bucket: BUCKET_NAME, Key: fileKey });
    const response = await s3.send(getCommand);
    const body = await response.Body?.transformToString();
    console.log("Cache hit: Serving from S3");
    return createResponse(200, JSON.parse(body!));
  } catch (e: any) {
    // 2. Cache miss: Aggregate, Store, and Return
    if (e.name === "NoSuchKey" || e.$metadata?.httpStatusCode === 404) {
      console.log("Cache miss: Aggregating feeds...");
      return await aggregateAndStore(fileKey);
    }
    return createResponse(500, { error: e.message });
  }
};

async function aggregateAndStore(key: string) {
  const feedPromises = FEEDS.map((f) => fetchWithTimeout(f));

  const settled = await Promise.allSettled(feedPromises);

  const results = settled
    .filter((r): r is PromiseFulfilledResult<Array<{ source: string; title?: string; link?: string; date: number }>> => 
      r.status === "fulfilled"
    )
    .map((r) => r.value);

  const news = results.flat().sort((a, b) => b.date - a.date);

  // If ALL feeds fail, don't overwrite cache with empty array
  if (news.length === 0) {
    throw new Error("All feeds failed or timed out. Aborting S3 write.");
  }

  // Bake into S3
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    Body: JSON.stringify(news),
    ContentType: "application/json"
  }));

  return createResponse(200, news);
}

const createResponse = (status: number, body: any) => ({
  statusCode: status,
  headers: { 
    "Content-Type": "application/json", 
    "Access-Control-Allow-Origin": "*" 
  },
  body: JSON.stringify(body),
});