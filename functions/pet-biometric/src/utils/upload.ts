import { randomUUID } from 'node:crypto';
import { DeleteObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import env from '../config/env';
import s3Client from '../config/s3';

export const ALLOWED_UPLOAD_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

function detectMimeFromBuffer(buffer: Buffer): string | null {
  if (!buffer || buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (
    buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47 &&
    buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a
  ) return 'image/png';
  if (
    buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38 &&
    (buffer[4] === 0x37 || buffer[4] === 0x39) && buffer[5] === 0x61
  ) return 'image/gif';
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
 * Uploads one validated image buffer directly to S3.
 *
 * Face ID intentionally keeps its own storage model minimal. The only
 * persisted Face ID references live in `pet_biometrics`, so this helper does
 * not create ancillary MongoDB records such as `image_collections`.
 *
 * @throws Error with `code: 'INVALID_FILE_TYPE'` when the file signature does
 * not match the allowlisted image MIME set.
 * @throws Error with `code: 'FILE_TOO_LARGE'` when the raw buffer exceeds the
 * API Gateway-safe upload size limit.
 */
export async function uploadImageFile(
  file: { buffer: Buffer; originalname: string },
  folder: string
): Promise<string> {
  const detectedMime = detectMimeFromBuffer(file.buffer);
  if (!detectedMime || !ALLOWED_UPLOAD_MIME.has(detectedMime)) {
    throw Object.assign(new Error('Unsupported file type'), { code: 'INVALID_FILE_TYPE' });
  }
  if (file.buffer.length > MAX_UPLOAD_BYTES) {
    throw Object.assign(new Error('File exceeds maximum allowed size'), { code: 'FILE_TOO_LARGE' });
  }

  const ext = EXT_MAP[detectedMime] || 'bin';
  const fileName = `${randomUUID()}.${ext}`;
  const key = `${folder}/${fileName}`;

  await s3Client.send(
    new PutObjectCommand({
      Bucket: env.AWS_BUCKET_NAME,
      Key: key,
      Body: file.buffer,
      ContentType: detectedMime,
    })
  );

  return key;
}

/**
 * Deletes one Face ID image object from S3 by key.
 *
 * The caller decides whether deletion failures should abort the request or be
 * treated as best-effort cleanup.
 */
export async function deleteImageFile(key: string): Promise<void> {
  await s3Client.send(
    new DeleteObjectCommand({
      Bucket: env.AWS_BUCKET_NAME,
      Key: key,
    })
  );
}
