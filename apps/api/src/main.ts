import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { validationExceptionFactory } from './common/pipes/validation-exception-factory';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Render sits behind a proxy; trust its first hop so req.ip resolves the
  // real caller instead of the proxy, for the conversation endpoint's
  // hashedIp and rate limiting.
  app.set('trust proxy', 1);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: validationExceptionFactory,
    }),
  );

  const corsOrigin = process.env.CORS_ORIGIN?.split(',') ?? [
    'http://localhost:3000',
  ];
  app.enableCors({ origin: corsOrigin });

  const port = process.env.PORT ?? 3001;
  await app.listen(port, '0.0.0.0');
}
void bootstrap();
