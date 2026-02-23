import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { getCorsMethods, getCorsOrigins } from './config/cors.config';
import { PrismaService } from './prisma/prisma.service';
import './instrument';
// import rateLimit dynamically inside bootstrap for compatibility
// import helmet dynamically inside bootstrap for compatibility
//TODO: middleware for logging, error handling, and security
//https://docs.nestjs.com/techniques/performance

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      logger: true, // Enable logging
      trustProxy: true, // Trust the proxy headers
      bodyLimit: 10485760, // Set body limit to 10MB
    }),
  );

  const configService = app.get(ConfigService);
  const prismaService = app.get(PrismaService);
  const origins = getCorsOrigins(configService.get<string>('CORS_ORIGIN'));
  app.enableCors({
    origin: origins,
    methods: getCorsMethods(),
    credentials: true,
  });

  await app.register(require('@fastify/helmet'), {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'", 'https://api.zenlot.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: [],
      },
    },
  });

  const rateLimitMaxRaw =
    configService.get<string>('RATE_LIMIT_MAX_REQUESTS') ?? '100';
  const rateLimitWindowRaw =
    configService.get<string>('RATE_LIMIT_WINDOW_MS') ?? '1 minute';
  const rateLimitMax = Number(rateLimitMaxRaw);
  const rateLimitWindow = /^\d+$/.test(String(rateLimitWindowRaw))
    ? Number(rateLimitWindowRaw)
    : rateLimitWindowRaw;

  await app.register(require('@fastify/rate-limit'), {
    max: Number.isFinite(rateLimitMax) ? rateLimitMax : 100, // Limit each IP to N requests per window
    timeWindow: rateLimitWindow, // Time window for rate limiting
    keyGenerator: (req) => req.ip, // Use the request IP as the key
    skipOnError: true, // Skip rate limiting on error responses
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  const nodeEnv = (process.env.NODE_ENV || '').toLowerCase();
  const swaggerEnabledRaw = configService.get<string>('SWAGGER_ENABLED') ?? '';
  const swaggerEnabled =
    ['1', 'true', 'yes'].includes(swaggerEnabledRaw.toLowerCase()) ||
    (nodeEnv !== 'production' && nodeEnv !== 'prod');

  if (swaggerEnabled) {
    const config = new DocumentBuilder()
      .setTitle('Zenlot APIs')
      .setDescription('Zenlot API documentation')
      .setVersion('1.0.0')
      //.addBearerAuth()
      .addApiKey(
        {
          type: 'apiKey',
          name: 'access_token',
          in: 'header',
        },
        'access-token',
      )
      .build();
    const documentFactory = () => SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, documentFactory);
  }

  app.enableShutdownHooks();
  await prismaService.enableShutdownHooks(app);

  const port = process.env.PORT || 3000;
  await app.listen(port, '0.0.0.0');
  console.log(
    `🚀  Zenlot API running on http://localhost:${port} in ${process.env.NODE_ENV} environment`,
  );
}
bootstrap();

//TODO: look into using a reverse proxy like Nginx or Caddy for production deployments
//TODO: consider using Docker for containerization and deployment
