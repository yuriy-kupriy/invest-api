import { HttpException, HttpStatus } from '@nestjs/common';

export class ProblemException extends HttpException {
  readonly code: string;

  constructor(status: HttpStatus, code: string, detail: string) {
    super(detail, status);
    this.code = code;
  }
}

export function problem(status: HttpStatus, code: string, detail: string): ProblemException {
  return new ProblemException(status, code, detail);
}
