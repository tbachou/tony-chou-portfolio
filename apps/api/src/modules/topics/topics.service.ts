import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type TopicResponse = {
  id: string;
  slug: string;
  label: string;
  description: string;
};

@Injectable()
export class TopicsService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(): Promise<TopicResponse[]> {
    return this.prisma.topic.findMany({
      select: { id: true, slug: true, label: true, description: true },
      orderBy: { sortOrder: 'asc' },
    });
  }
}
