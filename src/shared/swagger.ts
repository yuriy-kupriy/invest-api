import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AccountDto, AccountPageDto } from '@/accounts/dto/account.dto';
import { i18n, localizeOpenApiDocument } from '@/i18n/swagger';
import { DbHealthDto, HealthDto } from '@/health/dto/health.dto';
import { ProblemDto, ProblemErrorDto } from '@/shared/dto/problem.dto';
import { VERSION } from '@/shared/version';
import {
  TransactionBatchDto,
  TransactionDto,
  TransactionPageDto,
} from '@/transactions/dto/transaction.dto';

export function setupSwagger(app: INestApplication, port: number): void {
  const config = new DocumentBuilder()
    .setTitle(i18n('info.title'))
    .setDescription(i18n('info.description'))
    .setVersion(VERSION)
    .addServer(`http://localhost:${port}`, i18n('info.server'))
    .addTag('accounts', i18n('tags.accounts'))
    .addTag('transactions', i18n('tags.transactions'))
    .addTag('health', i18n('tags.health'))
    .build();

  const document = SwaggerModule.createDocument(app, config, {
    extraModels: [
      ProblemDto,
      ProblemErrorDto,
      AccountDto,
      AccountPageDto,
      TransactionDto,
      TransactionPageDto,
      TransactionBatchDto,
      HealthDto,
      DbHealthDto,
    ],
  });

  SwaggerModule.setup('docs', app, document, { jsonDocumentUrl: 'docs-json' });
  SwaggerModule.setup('docs/uk', app, localizeOpenApiDocument(document, 'uk'), {
    jsonDocumentUrl: 'docs-json/uk',
  });
}
