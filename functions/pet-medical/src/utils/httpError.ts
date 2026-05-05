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
