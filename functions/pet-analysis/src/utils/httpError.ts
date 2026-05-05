export class HttpError extends Error {
  statusCode: number;
  errorKey: string;

  constructor(statusCode: number, errorKey: string) {
    super(errorKey);
    this.statusCode = statusCode;
    this.errorKey = errorKey;
  }
}
