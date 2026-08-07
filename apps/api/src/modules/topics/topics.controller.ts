import { Controller, Get } from '@nestjs/common';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';
import { TopicsService, TopicResponse } from './topics.service';

@Controller('topics')
@AllowAnonymous()
export class TopicsController {
  constructor(private readonly topicsService: TopicsService) {}

  @Get()
  findAll(): Promise<TopicResponse[]> {
    return this.topicsService.findAll();
  }
}
