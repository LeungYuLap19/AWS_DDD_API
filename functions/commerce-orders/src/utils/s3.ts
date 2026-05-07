import mongoose from 'mongoose';
import axios from 'axios';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import env from '../config/env';
import s3Client from '../config/s3';

export const ALLOWED_UPLOAD_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024; // 4 MB — with BinaryMediaTypes: multipart/form-data, API GW base64-encodes (4 MB → ~5.33 MB), safely under Lambda's 6 MB synchronous invocation limit

/**
 * Detects MIME type from magic bytes. Returns null if unrecognised.
 */
export function detectMimeFromBuffer(buffer: Buffer): string | null {
  if (!buffer || buffer.length < 12) return null;
  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47 &&
    buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a
  ) return 'image/png';
  // GIF87a / GIF89a
  if (
    buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38 &&
    (buffer[4] === 0x37 || buffer[4] === 0x39) && buffer[5] === 0x61
  ) return 'image/gif';
  // WebP: RIFF????WEBP
  if (
    buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
    buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50
  ) return 'image/webp';
  return null;
}

const EXT_MAP: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

/**
 * Uploads a file buffer to S3 and records the upload in ImageCollection.
 * The DB connection must be established before calling this.
 */
export async function addImageFileToStorage(
  file: { buffer: Buffer; originalname: string },
  folder: string,
  owner = 'user'
): Promise<string> {
  const detectedMime = detectMimeFromBuffer(file.buffer);

  if (!detectedMime || !ALLOWED_UPLOAD_MIME.has(detectedMime)) {
    const err = Object.assign(new Error('Unsupported file type'), { code: 'INVALID_FILE_TYPE' });
    throw err;
  }
  if (file.buffer.length > MAX_UPLOAD_BYTES) {
    const err = Object.assign(new Error('File exceeds maximum allowed size'), { code: 'FILE_TOO_LARGE' });
    throw err;
  }

  const ext = EXT_MAP[detectedMime] || 'bin';
  const ImageCollection = mongoose.model('ImageCollection');
  const img = await ImageCollection.create({});
  const fileName = `${img._id}.${ext}`;
  const key = `${folder}/${fileName}`;
  const url = `${env.AWS_BUCKET_BASE_URL}/${key}`;

  await s3Client.send(
    new PutObjectCommand({
      Bucket: env.AWS_BUCKET_NAME,
      Key: key,
      Body: file.buffer,
      ACL: 'public-read',
      ContentType: detectedMime,
    })
  );

  await ImageCollection.updateOne(
    { _id: img._id },
    {
      $set: {
        fileName,
        url,
        fileSize: file.buffer.length / (1024 * 1024),
        mimeType: detectedMime,
        owner,
      },
    }
  );

  return url;
}

/**
 * Generates a QR code image via qrserver.com, uploads to S3, and returns the URL.
 * Falls back to the direct API URL on any failure.
 */
export async function uploadQrCodeImage(shortUrl: string): Promise<string> {
  const qrApiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(shortUrl)}`;
  try {
    const axiosResponse = await axios.get<ArrayBuffer>(qrApiUrl, { responseType: 'arraybuffer', timeout: 4000 });
    const imageBuffer = Buffer.from(axiosResponse.data);

    const ImageCollection = mongoose.model('ImageCollection');
    const img = await ImageCollection.create({});
    const fileName = `${img._id}.png`;
    const key = `qr-codes/${fileName}`;
    const url = `${env.AWS_BUCKET_BASE_URL}/${key}`;

    await s3Client.send(
      new PutObjectCommand({
        Bucket: env.AWS_BUCKET_NAME,
        Key: key,
        Body: imageBuffer,
        ACL: 'public-read',
        ContentType: 'image/png',
      })
    );

    await ImageCollection.updateOne(
      { _id: img._id },
      {
        $set: {
          fileName,
          url,
          fileSize: imageBuffer.length / (1024 * 1024),
          mimeType: 'image/png',
          owner: 'system',
        },
      }
    );

    return url;
  } catch {
    return qrApiUrl;
  }
}
