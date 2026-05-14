import mongoose from 'mongoose';
import axios from 'axios';
import { logWarn } from '@aws-ddd-api/shared';
import env from '../config/env';
// ── Email ─────────────────────────────────────────────────────────────────────

export function normalizeEmail(email: unknown): string {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

// ── Tag ID generation ─────────────────────────────────────────────────────────

const ALPHABET = 'ACDEFGHJKLMNPQRTUVWXYZ';
const NUMBERS = '23456789';

function pick(chars: string): string {
  return chars[Math.floor(Math.random() * chars.length)];
}

function generateTagId(): string {
  return pick(ALPHABET) + pick(NUMBERS) + pick(ALPHABET) + pick(NUMBERS) + pick(ALPHABET) + pick(NUMBERS);
}

export async function generateUniqueTagId(): Promise<string> {
  const OrderVerification = mongoose.model('OrderVerification');
  let tagId: string;
  do {
    tagId = generateTagId();
  } while (await OrderVerification.findOne({ tagId }, { _id: 1 }).lean());
  return tagId;
}

// ── Pricing ───────────────────────────────────────────────────────────────────

export async function resolveCanonicalPrice(shopCode: string): Promise<{ canonicalPrice: number } | null> {
  if (!shopCode) {
    return { canonicalPrice: 0 };
  }
  const ShopInfo = mongoose.model('ShopInfo');
  const shop = (await ShopInfo.findOne({ shopCode }, { price: 1 }).lean()) as { price?: unknown } | null;
  if (!shop) return null;
  const canonicalPrice = typeof shop.price === 'number' ? shop.price : parseFloat(String(shop.price)) || 0;
  return { canonicalPrice };
}

// ── URL shortening ────────────────────────────────────────────────────────────

async function shortenUrl(longUrl: string): Promise<string> {
  const apiKey = env.CUTTLY_API_KEY;
  if (!apiKey) return longUrl;
  try {
    const res = await axios.get<{ url?: { shortLink?: string } }>('https://cutt.ly/api/api.php', {
      params: { key: apiKey, short: longUrl },
      timeout: 3000,
    });
    if (res.data?.url?.shortLink) return res.data.url.shortLink;
    return longUrl;
  } catch (error) {
    logWarn('URL shortening failed, falling back to original URL', { error, scope: 'commerce-orders.utils.helpers' });
    return longUrl;
  }
}

export async function resolveShortUrl(isPTagAir: boolean, tagId: string): Promise<string> {
  if (isPTagAir) return 'www.ptag.com.hk/landing';
  return shortenUrl(`https://www.ptag.com.hk/php/qr_info.php?qr=${tagId}`);
}
