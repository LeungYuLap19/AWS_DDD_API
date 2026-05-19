import mongoose from 'mongoose';
import axios from 'axios';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { logWarn } from '@aws-ddd-api/shared/logging/logger';
import env from '../config/env';
import s3Client from '../config/s3';

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
  } catch (error) {
    logWarn('QR code S3 upload failed, falling back to external URL', { error, scope: 'commerce-orders.utils.s3' });
    return qrApiUrl;
  }
}
