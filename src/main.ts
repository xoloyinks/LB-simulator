import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import { join } from 'path';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableCors({
    origin: '*'
  })
  app.useStaticAssets(join(__dirname, '..', 'public')); // serves the dashboard at /
  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`Load balancer simulator running on http://localhost:${port}`);
}
bootstrap();
