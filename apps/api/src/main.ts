import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { validationExceptionFactory } from './common/pipes/validation-exception-factory';
import { resolveAllowedOrigins } from './common/utils/allowed-origins.util';

async function bootstrap() {
  // AuthModule (app.module.ts) disables and replaces Nest's default body
  // parser itself; nothing to configure here for that.
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Render sits behind a proxy; trust its first hop so req.ip resolves the
  // real caller instead of the proxy, for the conversation endpoint's
  // hashedIp and rate limiting.
  // This trust-topology fact also lives in apps/api/src/lib/auth.ts (better-auth's
  // advanced.ipAddress.trustedProxies) — change both together.
  app.set('trust proxy', 1);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: validationExceptionFactory,
    }),
  );

  // Same resolver OriginCheckGuard uses, so the CORS list and the CSRF list
  // cannot drift; a CSRF check trusting an origin CORS does not would be
  // worthless. Note CORS is not itself a CSRF defence: for anything but a
  // preflight the cors middleware calls next(), so the handler still runs.
  const corsOrigin = resolveAllowedOrigins();
  // credentials: true is required for better-auth's session cookie to be
  // set/sent cross origin (apps/web and apps/api are separate origins).
  app.enableCors({ origin: corsOrigin, credentials: true });

  const port = process.env.PORT ?? 3001;
  await app.listen(port, '0.0.0.0');
}
void bootstrap();
