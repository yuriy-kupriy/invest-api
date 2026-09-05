import { getSchemaPath } from '@nestjs/swagger';
import { ProblemDto } from '@/shared/dto/problem.dto';

export function problemResponse(description: string) {
  return {
    description,
    content: {
      'application/problem+json': {
        schema: { $ref: getSchemaPath(ProblemDto) },
      },
    },
  };
}
