import { Module } from '@nestjs/common';
import { AccessRequestsController } from './access-requests.controller';
import { AccessRequestsService } from './access-requests.service';
import { InternalAccessRequestsController } from './internal-access-requests.controller';

@Module({
  controllers: [AccessRequestsController, InternalAccessRequestsController],
  providers: [AccessRequestsService],
})
export class AccessRequestsModule {}
