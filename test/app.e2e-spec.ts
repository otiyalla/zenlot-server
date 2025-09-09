import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

// Import expect from Jest
import { expect, describe, beforeAll, afterAll, it, beforeEach } from '@jest/globals';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  //let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();

    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  it('/users (POST & GET)', async () => {
    const res = await request(app.getHttpServer())
      .post('/users')
      .send({ email: 'e2e@zenlot.io', name: 'E2E User' })
      .expect(201);
    const id = res.body.id;

    const user = await request(app.getHttpServer()).get(`/users/${id}`).expect(200);
    expect(user.body.email).toBe('e2e@zenlot.io');
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });
});
