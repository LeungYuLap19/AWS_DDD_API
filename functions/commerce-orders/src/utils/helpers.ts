import mongoose from 'mongoose';
import axios from 'axios';
import { logWarn } from '@aws-ddd-api/shared/logging/logger';
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

type PtagTier = {
  type?: unknown;
  price?: unknown;
};

type PtagProductDoc = {
  name?: unknown;
  deliveryCharge?: unknown;
  tiers?: unknown;
  options?: { sizes?: unknown; colours?: unknown };
};

type ShopInfoDoc = {
  price?: unknown;
};

export type AuthoritativePricingResult = {
  itemBasePrice: number;
  shopCodeDiscount: number;
  deliveryFee: number;
  finalPrice: number;
  resolvedProductName: string;
  resolvedTierType: string;
};

export type AuthoritativePricingError =
  | 'INVALID_PRODUCT_SELECTION'
  | 'INVALID_SHOP_CODE'
  | 'INVALID_OPTION_SIZE'
  | 'INVALID_OPTION_COLOUR';

type ResolveAuthoritativePricingInput = {
  option: string;
  type: string;
  shopCode: string;
  optionSize: string;
  optionColor: string;
};

const MONEY_FACTOR = 100;

function asFiniteNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function toMoneyCents(value: unknown): number {
  return Math.round(asFiniteNumber(value) * MONEY_FACTOR);
}

function fromMoneyCents(cents: number): number {
  return Number((cents / MONEY_FACTOR).toFixed(2));
}

function normalizeToken(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_-]+/g, '');
}

function parseOptionTokens(optionRaw: string): { productToken: string; tierToken: string } {
  const normalized = optionRaw.trim().toLowerCase();
  const token = normalizeToken(optionRaw);

  if (normalized === 'ptagair_member' || normalized === 'ptag_air_member' || token === 'ptagairmember') {
    return { productToken: 'ptagair', tierToken: 'custom' };
  }
  if (normalized === 'ptagair' || normalized === 'ptag_air' || token === 'ptagair') {
    return { productToken: 'ptagair', tierToken: 'standard' };
  }
  if (token === 'ptagclassic' || token === 'ptag') {
    return { productToken: 'ptag', tierToken: '' };
  }

  return { productToken: token, tierToken: '' };
}

function resolveRequestedTier(typeRaw: string, optionTierToken: string): string {
  const normalizedType = normalizeToken(typeRaw);
  if (normalizedType) return normalizedType;
  return optionTierToken;
}

function pickTier(
  tiers: PtagTier[],
  requestedTierToken: string
): { resolvedTierType: string; basePrice: number } | null {
  const normalizedRequested = normalizeToken(requestedTierToken);

  const normalizedTiers = tiers
    .map((tier) => {
      const typeRaw = typeof tier?.type === 'string' ? tier.type : '';
      const normalizedType = normalizeToken(typeRaw);
      if (!normalizedType) return null;
      return {
        rawType: typeRaw.trim(),
        normalizedType,
        price: tier?.price,
      };
    })
    .filter((tier): tier is { rawType: string; normalizedType: string; price: unknown } => Boolean(tier));

  if (normalizedTiers.length === 0) return null;

  if (normalizedRequested) {
    const direct = normalizedTiers.find((tier) => tier.normalizedType === normalizedRequested);
    if (direct) return { resolvedTierType: direct.rawType, basePrice: asFiniteNumber(direct.price) };
  }

  if (normalizedRequested === 'normal') {
    const standard = normalizedTiers.find((tier) => tier.normalizedType === 'standard');
    if (standard) return { resolvedTierType: standard.rawType, basePrice: asFiniteNumber(standard.price) };
  }
  if (normalizedRequested === 'standard') {
    const normal = normalizedTiers.find((tier) => tier.normalizedType === 'normal');
    if (normal) return { resolvedTierType: normal.rawType, basePrice: asFiniteNumber(normal.price) };
  }

  if (!normalizedRequested) {
    const preferred = normalizedTiers.find((tier) => tier.normalizedType === 'normal')
      ?? normalizedTiers.find((tier) => tier.normalizedType === 'standard')
      ?? normalizedTiers[0];
    return { resolvedTierType: preferred.rawType, basePrice: asFiniteNumber(preferred.price) };
  }

  return null;
}

export async function resolveAuthoritativePricing(
  input: ResolveAuthoritativePricingInput
): Promise<{ ok: true; data: AuthoritativePricingResult } | { ok: false; error: AuthoritativePricingError }> {
  const { option, type, shopCode, optionSize, optionColor } = input;
  const { productToken, tierToken } = parseOptionTokens(option);
  const requestedTier = resolveRequestedTier(type, tierToken);

  const PtagProduct = mongoose.model('PtagProduct');
  const productRows = (await PtagProduct.find({}, { name: 1, deliveryCharge: 1, tiers: 1, options: 1 }).lean()) as PtagProductDoc[];
  const matchedProduct = productRows.find((row) => normalizeToken(String(row?.name ?? '')) === productToken) ?? null;
  if (!matchedProduct) return { ok: false, error: 'INVALID_PRODUCT_SELECTION' };

  const productName = typeof matchedProduct.name === 'string' ? matchedProduct.name.trim() : '';
  const tiers = Array.isArray(matchedProduct.tiers) ? (matchedProduct.tiers as PtagTier[]) : [];
  const tier = pickTier(tiers, requestedTier);
  if (!tier) return { ok: false, error: 'INVALID_PRODUCT_SELECTION' };

  const sizes = Array.isArray(matchedProduct.options?.sizes)
    ? (matchedProduct.options.sizes as unknown[]).map((s) => normalizeToken(String(s)))
    : [];
  const colours = Array.isArray(matchedProduct.options?.colours)
    ? (matchedProduct.options.colours as unknown[]).map((c) => normalizeToken(String(c)))
    : [];

  if (sizes.length > 0) {
    const normalizedSize = normalizeToken(optionSize);
    if (!normalizedSize || !sizes.includes(normalizedSize)) {
      return { ok: false, error: 'INVALID_OPTION_SIZE' };
    }
  }
  if (colours.length > 0) {
    const normalizedColour = normalizeToken(optionColor);
    if (!normalizedColour || !colours.includes(normalizedColour)) {
      return { ok: false, error: 'INVALID_OPTION_COLOUR' };
    }
  }

  const itemBasePriceCents = toMoneyCents(tier.basePrice);
  const deliveryFeeCents = toMoneyCents(matchedProduct.deliveryCharge);

  let shopCodePriceCents: number | null = null;
  if (shopCode) {
    const ShopInfo = mongoose.model('ShopInfo');
    const shop = (await ShopInfo.findOne({ shopCode }, { price: 1 }).lean()) as ShopInfoDoc | null;
    if (!shop) return { ok: false, error: 'INVALID_SHOP_CODE' };
    shopCodePriceCents = toMoneyCents(shop.price);
  }

  // When a shop code is provided, ShopInfo.price is the authoritative item price for that shop
  // (e.g. SPCA VIP price $199). Delivery fee is always added on top.
  // Without a shop code, fall back to the product tier base price.
  const effectiveItemPriceCents = shopCodePriceCents !== null ? shopCodePriceCents : itemBasePriceCents;
  const finalPriceCents = Math.max(effectiveItemPriceCents + deliveryFeeCents, 0);
  return {
    ok: true,
    data: {
      itemBasePrice: fromMoneyCents(itemBasePriceCents),
      shopCodeDiscount: shopCodePriceCents !== null ? fromMoneyCents(itemBasePriceCents - shopCodePriceCents) : 0,
      deliveryFee: fromMoneyCents(deliveryFeeCents),
      finalPrice: fromMoneyCents(finalPriceCents),
      resolvedProductName: productName,
      resolvedTierType: tier.resolvedTierType,
    },
  };
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
