import { Controller, Get } from '@nestjs/common';
import { StoriesService, StoryResponse } from './stories.service';

@Controller('stories')
export class StoriesController {
  constructor(private readonly storiesService: StoriesService) {}

  @Get()
  findAll(): Promise<StoryResponse[]> {
    return this.storiesService.findAll();
  }
}
