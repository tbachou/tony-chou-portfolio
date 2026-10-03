import { Module } from '@nestjs/common';
import { StoriesController } from './stories.controller.js';
import { StoriesService } from './stories.service.js';

@Module({
  controllers: [StoriesController],
  providers: [StoriesService],
  exports: [StoriesService],
})
export class StoriesModule {}
