import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuthUser } from '@/auth/auth.types';
import { CurrentUser, Roles } from '@/auth/decorators';
import { FilesService, IntentRequest } from './files.service';

/**
 * Two-step upload: intent → client PUTs to storage directly → commit. Request
 * bodies are validated by the OpenAPI validator (openapi.yaml), which is the
 * schema of record for these routes; the service re-checks what matters.
 */
@ApiTags('uploads')
@Controller('uploads')
@Roles('member')
export class FilesController {
  constructor(private readonly files: FilesService) {}

  @Post('intent')
  @HttpCode(HttpStatus.OK)
  intent(@Body() body: IntentRequest, @CurrentUser() user: AuthUser) {
    return this.files.intent(body, user);
  }

  @Post('parts')
  @HttpCode(HttpStatus.OK)
  parts(@Body() body: { fileId: string }, @CurrentUser() user: AuthUser) {
    return this.files.parts(body.fileId, user);
  }

  @Post('commit')
  @HttpCode(HttpStatus.OK)
  commit(@Body() body: { fileId: string }, @CurrentUser() user: AuthUser) {
    return this.files.commit(body.fileId, user);
  }
}
