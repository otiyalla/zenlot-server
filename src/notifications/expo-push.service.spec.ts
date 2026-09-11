import { ConfigService } from '@nestjs/config';
import { ExpoPushService } from './expo-push.service';

// A real-looking Expo token so Expo.isExpoPushToken passes.
const TOKEN_A = 'ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]';
const TOKEN_B = 'ExponentPushToken[bbbbbbbbbbbbbbbbbbbbbb]';

function makeService(expoMock: Record<string, jest.Mock>) {
  const service = new ExpoPushService({
    get: () => undefined,
  } as unknown as ConfigService);
  // Replace the internally-constructed Expo client with our fake.
  (service as unknown as { expo: unknown }).expo = {
    chunkPushNotifications: (m: unknown[]) => [m],
    chunkPushNotificationReceiptIds: (ids: unknown[]) => [ids],
    ...expoMock,
  };
  return service;
}

describe('ExpoPushService.send', () => {
  it('flags non-Expo tokens as invalid without sending them', async () => {
    const sendPushNotificationsAsync = jest.fn();
    const service = makeService({ sendPushNotificationsAsync });

    const result = await service.send(['not-a-token'], { body: 'hi' });

    expect(sendPushNotificationsAsync).not.toHaveBeenCalled();
    expect(result.sentTokens).toEqual([]);
    expect(result.invalidTokens).toEqual(['not-a-token']);
  });

  it('returns accepted tokens and polls receipts', async () => {
    const sendPushNotificationsAsync = jest.fn().mockResolvedValue([
      { status: 'ok', id: 'r1' },
      { status: 'ok', id: 'r2' },
    ]);
    const getPushNotificationReceiptsAsync = jest
      .fn()
      .mockResolvedValue({ r1: { status: 'ok' }, r2: { status: 'ok' } });
    const service = makeService({
      sendPushNotificationsAsync,
      getPushNotificationReceiptsAsync,
    });

    const result = await service.send([TOKEN_A, TOKEN_B], { body: 'hi' });

    expect(sendPushNotificationsAsync).toHaveBeenCalledTimes(1);
    expect(result.sentTokens).toEqual([TOKEN_A, TOKEN_B]);
    expect(result.invalidTokens).toEqual([]);
  });

  it('marks DeviceNotRegistered tokens invalid from immediate ticket errors', async () => {
    const sendPushNotificationsAsync = jest.fn().mockResolvedValue([
      { status: 'ok', id: 'r1' },
      {
        status: 'error',
        message: 'gone',
        details: { error: 'DeviceNotRegistered' },
      },
    ]);
    const getPushNotificationReceiptsAsync = jest
      .fn()
      .mockResolvedValue({ r1: { status: 'ok' } });
    const service = makeService({
      sendPushNotificationsAsync,
      getPushNotificationReceiptsAsync,
    });

    const result = await service.send([TOKEN_A, TOKEN_B], { body: 'hi' });

    expect(result.sentTokens).toEqual([TOKEN_A]);
    expect(result.invalidTokens).toEqual([TOKEN_B]);
  });

  it('marks DeviceNotRegistered tokens invalid from deferred receipts', async () => {
    const sendPushNotificationsAsync = jest.fn().mockResolvedValue([
      { status: 'ok', id: 'r1' },
      { status: 'ok', id: 'r2' },
    ]);
    const getPushNotificationReceiptsAsync = jest.fn().mockResolvedValue({
      r1: { status: 'ok' },
      r2: {
        status: 'error',
        message: 'gone',
        details: { error: 'DeviceNotRegistered' },
      },
    });
    const service = makeService({
      sendPushNotificationsAsync,
      getPushNotificationReceiptsAsync,
    });

    const result = await service.send([TOKEN_A, TOKEN_B], { body: 'hi' });

    expect(result.sentTokens).toEqual([TOKEN_A]);
    expect(result.invalidTokens).toEqual([TOKEN_B]);
  });
});
