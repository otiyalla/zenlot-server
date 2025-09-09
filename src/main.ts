import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger'
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
    }),);
  
  app.enableCors({
    methods: ["GET", "POST", "PUT", "DELETE"]
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
  } );

  await app.register(require('@fastify/rate-limit'), {
    max: 100, // Limit each IP to 100 requests per windowMs
    timeWindow: '1 minute', // Time window for rate limiting
    keyGenerator: (req) => req.ip, // Use the request IP as the key
    skipOnError: true, // Skip rate limiting on error responses
  });

  
  app.useGlobalPipes(
    new ValidationPipe({ 
      whitelist: true, 
      forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
    }));

    const config = new DocumentBuilder()
    .setTitle('Zenlot APIs')
    .setDescription('Zenlot API documentation')
    .setVersion('1.0.0')
    //.addBearerAuth()
    .addApiKey({
      type: "apiKey",
      name: "access_token",
      in: "header"
    }, 'access-token')
    .build();
    const documentFactory = () => SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, documentFactory);

  
  const port = process.env.PORT || 3000;
  await app.listen(port, '0.0.0.0');
  console.log(`🚀  Zenlot API running on http://localhost:${port}`);
}
bootstrap();

//TODO: look into using a reverse proxy like Nginx or Caddy for production deployments
//TODO: consider using Docker for containerization and deployment
//TODO: Use swagger for API documentation
