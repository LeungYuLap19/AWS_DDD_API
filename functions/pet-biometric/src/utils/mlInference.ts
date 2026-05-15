import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import env from '../config/env';

const lambdaClient = new LambdaClient({});

/** Supported internal Face ID operations handled by `ml-inference`. */
export type MlInvokeOperation = 'register' | 'verify';

/**
 * Register-operation payload returned by `ml-inference`.
 *
 * `pet-biometric` uses `status`, `angle`, and `embedding` to decide whether an
 * uploaded registration image should be persisted.
 */
export type MlRegisterPayload = {
  status?: string;
  angle?: string | null;
  score?: number | null;
  counts?: Record<string, number>;
  can_finish?: boolean;
  front_image?: string | null;
  embedding?: number[];
  petId?: string;
  petType?: string;
  image?: { bucket?: string; key?: string };
};

/**
 * Verify-operation payload returned by `ml-inference`.
 *
 * The result is mapped into a stable public verify response by
 * `pet-biometric` (`matched`, `completed`, `status`, `similarity`, `angle`).
 */
export type MlVerifyPayload = {
  status?: string;
  similarity?: number | null;
  angle?: string | null;
  threshold?: number;
  petId?: string;
  petType?: string;
  image?: { bucket?: string; key?: string };
  candidateCount?: number;
};

type MlSuccessEnvelope<T = unknown> = {
  ok: true;
  op: MlInvokeOperation;
  data: T;
};

type MlErrorEnvelope = {
  ok: false;
  statusCode?: number;
  errorKey?: string;
  message?: string;
};

/**
 * Invokes the internal `ml-inference` Lambda synchronously and unwraps the
 * standard `{ ok, op, data }` envelope used by the Face ID contract.
 */
export async function invokeMlInference<T>(
  params: {
    op: MlInvokeOperation;
    petId: string;
    body: Record<string, unknown>;
    requestId?: string | null;
  }
): Promise<T> {
  const payload = {
    op: params.op,
    petId: params.petId,
    body: params.body,
    requestId: params.requestId ?? undefined,
  };

  const result = await lambdaClient.send(
    new InvokeCommand({
      FunctionName: env.ML_INFERENCE_FUNCTION_NAME,
      InvocationType: 'RequestResponse',
      Payload: Buffer.from(JSON.stringify(payload)),
    })
  );

  if (result.FunctionError) {
    throw new Error(`ml-inference invoke failed: ${result.FunctionError}`);
  }

  const payloadText = result.Payload ? Buffer.from(result.Payload).toString('utf8') : '';
  if (!payloadText) return {} as T;

  let decoded: unknown;
  try {
    decoded = JSON.parse(payloadText);
  } catch {
    return { raw: payloadText } as T;
  }

  if (typeof decoded === 'object' && decoded !== null && 'ok' in decoded) {
    const maybeErr = decoded as MlErrorEnvelope;
    if (maybeErr.ok === false) {
      throw {
        statusCode: typeof maybeErr.statusCode === 'number' ? maybeErr.statusCode : 502,
        errorKey:
          typeof maybeErr.errorKey === 'string'
            ? maybeErr.errorKey
            : 'common.serviceUnavailable',
      };
    }

    const maybeOk = decoded as MlSuccessEnvelope<T>;
    if (maybeOk.ok === true) {
      return maybeOk.data;
    }
  }

  return decoded as T;
}
