export class HttpError extends Error {
  statusCode: number;
  errorKey: string;

  constructor(statusCode: number, errorKey: string) {
    super(errorKey);
    this.name = 'HttpError';
    this.statusCode = statusCode;
    this.errorKey = errorKey;
  }
}

export function throwHttpError(statusCode: number, errorKey: string): never {
  throw new HttpError(statusCode, errorKey);
}
