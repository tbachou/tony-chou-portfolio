import { Module } from '@nestjs/common';
import { AnthropicModule } from '../anthropic/anthropic.module';
import { ConversationController } from './conversation.controller';
import { ConversationService } from './conversation.service';

@Module({
  imports: [AnthropicModule],
  controllers: [ConversationController],
  providers: [ConversationService],
})
export class ConversationModule {}
