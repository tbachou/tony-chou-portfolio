import { Controller, Get } from '@nestjs/common';
import { TopicsService, TopicResponse } from './topics.service';

@Controller('topics')
export class TopicsController {
  constructor(private readonly topicsService: TopicsService) {}

  @Get()
  findAll(): Promise<TopicResponse[]> {
    return this.topicsService.findAll();
  }
}
