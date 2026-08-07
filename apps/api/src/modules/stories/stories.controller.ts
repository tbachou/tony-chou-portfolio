import { Controller, Get } from '@nestjs/common';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';
import { StoriesService, StoryResponse } from './stories.service';

@Controller('stories')
@AllowAnonymous()
export class StoriesController {
  constructor(private readonly storiesService: StoriesService) {}

  @Get()
  findAll(): Promise<StoryResponse[]> {
    return this.storiesService.findAll();
  }
}
