import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from '@thallesp/nestjs-better-auth';
import { auth } from './lib/auth';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { OriginCheckGuard } from './common/guards/origin-check.guard';
import { HealthModule } from './modules/health/health.module';
import { PrismaModule } from './modules/prisma/prisma.module';
import { StoriesModule } from './modules/stories/stories.module';
import { TopicsModule } from './modules/topics/topics.module';
import { ConversationModule } from './modules/conversation/conversation.module';
import { UsageSummaryModule } from './modules/usage-summary/usage-summary.module';
import { BetaModule } from './modules/beta/beta.module';
import { FeedbackModule } from './modules/feedback/feedback.module';
import { GradeModule } from './modules/grade/grade.module';
import { GradePhotosModule } from './modules/grade-photos/grade-photos.module';

/**
 * Grade Guesser is behind a flag until it is released (spec 0006 is built
 * only to build-plan step 4: no share button, no home teaser, placeholder
 * photos). Disabled means the module is NOT REGISTERED, so `/grade/*` does
 * not exist rather than existing and refusing: a route that 404s because it
 * was never mounted has no handler, no DTO, and no database access to reach.
 *
 * Absence of the variable means OFF, so the feature cannot go live by
 * forgetting to set something. Release is `GRADE_GAME_ENABLED=true` in the
 * api's environment, no code change.
 */
const gradeGameEnabled = process.env.GRADE_GAME_ENABLED === 'true';

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
    // Registered unconditionally, unlike GradeModule above: the photo pool
    // has to be fillable while the game is still hidden, so /internal/grade-photos
    // exists whatever GRADE_GAME_ENABLED says (spec 0006 R3). It is behind the
    // global better-auth guard, so it is not public surface.
    GradePhotosModule,
    ...(gradeGameEnabled ? [GradeModule] : []),
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
    // CSRF defence for every state-changing route, not just the one the
    // pre-deploy gate caught. CORS cannot do this job: for anything but a
    // preflight the cors middleware calls next(), so a disallowed origin
    // still reaches the handler. See the guard for the full reasoning.
    { provide: APP_GUARD, useClass: OriginCheckGuard },
  ],
})
export class AppModule {}
