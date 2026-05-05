import mongoose from 'mongoose';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import env from '../config/env';
import s3Client from '../config/s3';

const MAX_FILE_SIZE_MB = 10;

function getFileExtension(file: { originalname?: string }): string {
  const originalName = String(file.originalname || '');
  const lastDotIndex = originalName.lastIndexOf('.');
  if (lastDotIndex === -1 || lastDotIndex === originalName.length - 1) {
    return 'jpg';
  }

  return originalName.slice(lastDotIndex + 1).toLowerCase();
}

function getContentType(extension: string): string {
  const mimeByExtension: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    tif: 'image/tiff',
    tiff: 'image/tiff',
    webp: 'image/webp',
    bmp: 'image/bmp',
  };

  return mimeByExtension[extension] || 'image/jpeg';
}

export async function uploadImageFile(params: {
  buffer: Buffer;
  folder: string;
  originalname?: string;
  owner?: string;
}): Promise<string | null> {
  const fileSizeMb = params.buffer.length / (1024 * 1024);
  if (fileSizeMb > MAX_FILE_SIZE_MB) {
    return null;
  }

  const ImageCollection = mongoose.model('ImageCollection');
  const imageRecord = await ImageCollection.create({});

  const extension = getFileExtension({ originalname: params.originalname });
  const fileName = `${imageRecord._id}.${extension}`;
  const key = `${params.folder}/${fileName}`;
  const url = `${env.AWS_BUCKET_BASE_URL}/${key}`;
  const contentType = getContentType(extension);

  await s3Client.send(
    new PutObjectCommand({
      Bucket: env.AWS_BUCKET_NAME,
      Key: key,
      Body: params.buffer,
      ACL: 'public-read',
      ContentType: contentType,
    })
  );

  await ImageCollection.updateOne(
    { _id: imageRecord._id },
    {
      $set: {
        fileName,
        url,
        fileSize: fileSizeMb,
        mimeType: contentType,
        owner: params.owner || 'user',
      },
    }
  );

  return url;
}

export async function getNextSerialNumber(): Promise<string> {
  const RecoveryCounter = mongoose.model('RecoveryCounter');
  const counter = (await RecoveryCounter.findOneAndUpdate(
    { _id: 'petRecovery' },
    { $inc: { seq: 1 } },
    { upsert: true, new: true }
  )) as { seq?: number } | null;
  return String(counter?.seq ?? 1);
}
