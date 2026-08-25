import { HttpException, HttpStatus } from '@nestjs/common';
import { Request, Response } from 'express';
import { ProblemException } from '@/shared/problem.exception';

const PROBLEM_BASE = 'https://api.invest.example/problems';

const TITLES: Record<number, string> = {
  [HttpStatus.BAD_REQUEST]: 'Некоректний запит',
  [HttpStatus.NOT_FOUND]: 'Ресурс не знайдено',
  [HttpStatus.CONFLICT]: 'Конфлікт зі станом ресурсу',
  [HttpStatus.UNPROCESSABLE_ENTITY]: 'Тіло не пройшло перевірку',
  [HttpStatus.INTERNAL_SERVER_ERROR]: 'Внутрішня помилка сервера',
};

export interface ProblemBody {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance: string;
  code?: string;
  errors?: Array<{ path: string; message: string }>;
}

interface ErrorLike {
  status?: number;
  statusCode?: number;
  code?: string;
  message?: string;
  errors?: Array<{ path?: string; message?: string }>;
}

function detailFromHttpException(err: HttpException): string {
  const response = err.getResponse();
  if (typeof response === 'string') {
    return response;
  }
  if (typeof response === 'object' && response !== null && 'message' in response) {
    const message = (response as { message: unknown }).message;
    if (Array.isArray(message)) {
      return message.join('; ');
    }
    return String(message);
  }
  return err.message;
}

export function toProblem(err: unknown, req: Request): ProblemBody {
  if (err instanceof ProblemException) {
    const status = err.getStatus();
    return {
      type: `${PROBLEM_BASE}/${err.code}`,
      title: TITLES[status] ?? 'Помилка',
      status,
      detail: err.message,
      instance: req.originalUrl,
      code: err.code,
    };
  }

  if (err instanceof HttpException) {
    const status = err.getStatus();
    return {
      type: `${PROBLEM_BASE}/${status}`,
      title: TITLES[status] ?? 'Помилка',
      status,
      detail: detailFromHttpException(err),
      instance: req.originalUrl,
    };
  }

  const e = err as ErrorLike;
  const status = e.status ?? e.statusCode ?? HttpStatus.INTERNAL_SERVER_ERROR;
  const body: ProblemBody = {
    type: `${PROBLEM_BASE}/${e.code ?? status}`,
    title: TITLES[status] ?? 'Помилка',
    status,
    detail: e.message ?? 'Internal Server Error',
    instance: req.originalUrl,
  };
  if (e.code) {
    body.code = e.code;
  }
  if (Array.isArray(e.errors) && e.errors.length > 0) {
    body.errors = e.errors.map((item) => ({
      path: item.path ?? '',
      message: item.message ?? '',
    }));
  }
  return body;
}

export function sendProblem(err: unknown, req: Request, res: Response): void {
  const body = toProblem(err, req);
  res.status(body.status).type('application/problem+json').send(JSON.stringify(body));
}
