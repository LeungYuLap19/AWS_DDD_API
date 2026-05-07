import mongoose from 'mongoose';
import axios from 'axios';
import env from '../config/env';
import { ALLOWED_UPLOAD_MIME, MAX_UPLOAD_BYTES, detectMimeFromBuffer } from './s3';

// ── Email ─────────────────────────────────────────────────────────────────────

export function normalizeEmail(email: unknown): string {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

// ── File validation ───────────────────────────────────────────────────────────

export interface MultipartFile {
  content: Buffer;
  filename: string;
  fieldname: string;
  contentType: string;
  encoding: string;
}

export function validateUploadFiles(files: MultipartFile[], maxCount = 1): string | null {
  if (files.length > maxCount) return 'orders.errors.tooManyFiles';
  for (const f of files) {
    if (f.content.length > MAX_UPLOAD_BYTES) return 'orders.errors.fileTooLarge';
    const detectedMime = detectMimeFromBuffer(f.content);
    if (!detectedMime || !ALLOWED_UPLOAD_MIME.has(detectedMime)) return 'orders.errors.invalidFileType';
  }
  return null;
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
  if (!shopCode) return null;
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
  } catch {
    return longUrl;
  }
}

export async function resolveShortUrl(isPTagAir: boolean, tagId: string): Promise<string> {
  if (isPTagAir) return 'www.ptag.com.hk/landing';
  return shortenUrl(`https://www.ptag.com.hk/php/qr_info.php?qr=${tagId}`);
}
