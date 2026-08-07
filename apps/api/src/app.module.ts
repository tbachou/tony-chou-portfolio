import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { HealthModule } from './modules/health/health.module';
import { PrismaModule } from './modules/prisma/prisma.module';
import { StoriesModule } from './modules/stories/stories.module';
import { TopicsModule } from './modules/topics/topics.module';
import { ConversationModule } from './modules/conversation/conversation.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot({
      throttlers: [
        { name: 'short', ttl: 60_000, limit: 5 },
        { name: 'long', ttl: 3_600_000, limit: 30 },
      ],
    }),
    PrismaModule,
    HealthModule,
    StoriesModule,
    TopicsModule,
    ConversationModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
  ],
})
export class AppModule {}
