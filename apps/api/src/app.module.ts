import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from '@thallesp/nestjs-better-auth';
import { auth } from './lib/auth';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { HealthModule } from './modules/health/health.module';
import { PrismaModule } from './modules/prisma/prisma.module';
import { StoriesModule } from './modules/stories/stories.module';
import { TopicsModule } from './modules/topics/topics.module';
import { ConversationModule } from './modules/conversation/conversation.module';
import { UsageSummaryModule } from './modules/usage-summary/usage-summary.module';
import { BetaModule } from './modules/beta/beta.module';
import { FeedbackModule } from './modules/feedback/feedback.module';
import { GradeModule } from './modules/grade/grade.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot({
      throttlers: [
        { name: 'short', ttl: 60_000, limit: 5 },
        { name: 'long', ttl: 3_600_000, limit: 30 },
      ],
    }),
    // Registers a global auth guard (every route requires a session unless
    // marked @AllowAnonymous()) and mounts better-auth's own /api/auth/*
    // routes. This also disables and replaces Nest's default body parser
    // internally (confirmed from the package's own type definitions), so
    // nothing needs configuring here or in main.ts for that.
    AuthModule.forRoot({ auth }),
    PrismaModule,
    HealthModule,
    StoriesModule,
    TopicsModule,
    ConversationModule,
    UsageSummaryModule,
    BetaModule,
    FeedbackModule,
    GradeModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
  ],
})
export class AppModule {}
