import mongoose from 'mongoose';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import env from '../config/env';
import s3Client from '../config/s3';

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
    pdf: 'application/pdf',
  };

  return mimeByExtension[extension] || 'image/jpeg';
}

export async function uploadImageFile(params: {
  buffer: Buffer;
  folder: string;
  originalname?: string;
  owner?: string;
}): Promise<string> {
  const ImageCollection = mongoose.model('ImageCollection');
  const imageRecord = await ImageCollection.create({});

  const extension = getFileExtension({ originalname: params.originalname });
  const fileName = `${imageRecord._id}.${extension}`;
  const key = `${params.folder}/${fileName}`;
  const url = `${env.AWS_BUCKET_BASE_URL}/${key}`;
  const fileSizeMb = params.buffer.length / (1024 * 1024);

  await s3Client.send(
    new PutObjectCommand({
      Bucket: env.AWS_BUCKET_NAME,
      Key: key,
      Body: params.buffer,
      ACL: 'public-read',
      ContentType: getContentType(extension),
    })
  );

  await ImageCollection.updateOne(
    { _id: imageRecord._id },
    {
      $set: {
        fileName,
        url,
        fileSize: fileSizeMb,
        mimeType: getContentType(extension),
        owner: params.owner || 'user',
      },
    }
  );

  return url;
}
