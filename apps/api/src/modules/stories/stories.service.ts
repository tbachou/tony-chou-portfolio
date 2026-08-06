import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StoryOwnership } from '../../generated/prisma/enums';

export type StoryOwnershipWire = 'solo' | 'contributed' | 'co-led';

export type StoryResponse = {
  id: string;
  title: string;
  ownership: StoryOwnershipWire;
  engagement: string;
  summary: string;
};

const OWNERSHIP_TO_WIRE: Record<StoryOwnership, StoryOwnershipWire> = {
  [StoryOwnership.SOLO]: 'solo',
  [StoryOwnership.CONTRIBUTED]: 'contributed',
  [StoryOwnership.CO_LED]: 'co-led',
};

export function toWireOwnership(ownership: StoryOwnership): StoryOwnershipWire {
  return OWNERSHIP_TO_WIRE[ownership];
}

@Injectable()
export class StoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(): Promise<StoryResponse[]> {
    const stories = await this.prisma.story.findMany({
      select: {
        id: true,
        title: true,
        ownership: true,
        engagement: true,
        summary: true,
      },
    });

    return stories.map((story) => ({
      ...story,
      ownership: toWireOwnership(story.ownership),
    }));
  }
}
