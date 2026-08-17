import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import {
  AccessRequestAdminResponse,
  AccessRequestsService,
} from './access-requests.service';
import { ApproveAccessRequestDto } from './dto/approve-access-request.dto';

// Deliberately no @AllowAnonymous(): protected by the global auth guard
// (AuthModule.forRoot in app.module.ts), same pattern as UsageSummaryController.
// Manual, on-demand approval only — no automation.
@Controller('internal/access-requests')
export class InternalAccessRequestsController {
  constructor(private readonly accessRequestsService: AccessRequestsService) {}

  @Get()
  findAll(): Promise<AccessRequestAdminResponse[]> {
    return this.accessRequestsService.findAll();
  }

  @Post(':id/approve')
  approve(
    @Param('id') id: string,
    @Body() body: ApproveAccessRequestDto,
  ): Promise<AccessRequestAdminResponse> {
    return this.accessRequestsService.approve(id, body.downloadUrl);
  }

  @Post(':id/deny')
  deny(@Param('id') id: string): Promise<AccessRequestAdminResponse> {
    return this.accessRequestsService.deny(id);
  }
}
