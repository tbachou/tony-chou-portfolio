import { Controller, Get } from '@nestjs/common';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';

@Controller('health')
@AllowAnonymous()
export class HealthController {
  @Get()
  check() {
    return { status: 'ok' };
  }
}
