/**
 * Jest mock for expo-server-sdk. The real package ships ESM (it imports
 * `node:assert` and pulls in undici) which Jest's CommonJS ts-jest transform
 * does not process — loading it in a unit test throws "Cannot use import
 * statement outside a module". Unit tests don't exercise the real Expo HTTP
 * client (ExpoPushService swaps in a fake instance), they only need
 * `Expo.isExpoPushToken`, so this mock provides a faithful token validator and
 * a no-op client. Mapped in jest.config.js via moduleNameMapper.
 */
export type ExpoPushToken = string;
export type ExpoPushReceiptId = string;
export type ExpoPushMessage = {
  to: ExpoPushToken | ExpoPushToken[];
  [key: string]: unknown;
};
export type ExpoPushTicket =
  | { status: 'ok'; id: string }
  | { status: 'error'; message: string; details?: { error?: string } };
export type ExpoPushReceipt =
  | { status: 'ok' }
  | { status: 'error'; message: string; details?: { error?: string } };

const EXPO_TOKEN_RE = /^Expo(nent)?PushToken\[[^\]]+\]$/;

export class Expo {
  static isExpoPushToken(token: unknown): token is ExpoPushToken {
    return typeof token === 'string' && EXPO_TOKEN_RE.test(token);
  }

  constructor(_options?: unknown) {}

  chunkPushNotifications(messages: ExpoPushMessage[]): ExpoPushMessage[][] {
    return messages.length ? [messages] : [];
  }

  chunkPushNotificationReceiptIds(
    ids: ExpoPushReceiptId[],
  ): ExpoPushReceiptId[][] {
    return ids.length ? [ids] : [];
  }

  sendPushNotificationsAsync(): Promise<ExpoPushTicket[]> {
    return Promise.resolve([]);
  }

  getPushNotificationReceiptsAsync(): Promise<Record<string, ExpoPushReceipt>> {
    return Promise.resolve({});
  }
}

export default Expo;
