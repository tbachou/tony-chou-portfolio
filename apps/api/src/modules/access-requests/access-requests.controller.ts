import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';
import {
  AccessRequestsService,
  AccessRequestStatusResponse,
} from './access-requests.service';
import { AccessRequestStatusQueryDto } from './dto/access-request-status-query.dto';
import { CreateAccessRequestDto } from './dto/create-access-request.dto';

// Public, no-auth beta-access gate for the Electron app downloads (Panel,
// Carryover). Throttled the same way the other public write endpoint
// (conversation/turn) is, since it's an unauthenticated create.
@Controller('access-requests')
@AllowAnonymous()
@UseGuards(ThrottlerGuard)
export class AccessRequestsController {
  constructor(private readonly accessRequestsService: AccessRequestsService) {}

  @Post()
  @Throttle({ short: { limit: 5, ttl: 60_000 }, long: { limit: 30, ttl: 3_600_000 } })
  create(@Body() body: CreateAccessRequestDto): Promise<AccessRequestStatusResponse> {
    return this.accessRequestsService.requestAccess(body.email, body.appSlug);
  }

  @Get('status')
  status(
    @Query() query: AccessRequestStatusQueryDto,
  ): Promise<AccessRequestStatusResponse> {
    return this.accessRequestsService.getStatus(query.email, query.appSlug);
  }
}
