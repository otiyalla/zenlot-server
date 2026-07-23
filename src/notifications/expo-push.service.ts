import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Sentry from '@sentry/nestjs';
import {
  Expo,
  ExpoPushMessage,
  ExpoPushReceiptId,
  ExpoPushTicket,
} from 'expo-server-sdk';

/**
 * The outcome of pushing one batch of messages: which tokens delivered fine and
 * which tokens Expo rejected as undeliverable (so the caller can soft-disable
 * them). Errors that are transient (rate limits, provider errors) are logged but
 * the tokens are left enabled.
 */
export interface ExpoSendResult {
  sentTokens: string[];
  invalidTokens: string[];
}

/**
 * Thin wrapper around expo-server-sdk that owns the send + receipt-polling
 * mechanics: chunking to Expo's limits, mapping tickets/receipts back to tokens,
 * and identifying DeviceNotRegistered tokens for cleanup. Kept separate from the
 * business orchestration in NotificationsService so it can be unit-tested by
 * injecting a fake Expo client.
 */
@Injectable()
export class ExpoPushService {
  private readonly logger = new Logger(ExpoPushService.name);
  private readonly expo: Expo;
  constructor(private readonly config: ConfigService) {
    // An access token is optional for the Expo push API but recommended; when
    // "Enhanced Security for Push Notifications" is enabled in the Expo project
    // it becomes required. EXPO_ACCESS_TOKEN is read from env.
    const accessToken = this.config.get<string>('EXPO_ACCESS_TOKEN');
    this.expo = new Expo(accessToken ? { accessToken } : undefined);
  }

  /**
   * Sends one logical notification to many tokens. Returns the tokens that were
   * accepted and the tokens Expo flagged as undeliverable. Receipts are polled
   * after a short delay so DeviceNotRegistered tokens surfacing at the
   * receipt stage are also reported back.
   */
  async send(
    tokens: string[],
    message: Omit<ExpoPushMessage, 'to'>,
  ): Promise<ExpoSendResult> {
    const validTokens = tokens.filter((t) => Expo.isExpoPushToken(t));
    // Explicit type: the `!isExpoPushToken` guard narrows to `never`, which would
    // otherwise infer `never[]` and reject the per-token `.push()` calls below.
    const invalidTokens: string[] = tokens.filter(
      (t) => !Expo.isExpoPushToken(t),
    );

    if (validTokens.length === 0) {
      return { sentTokens: [], invalidTokens };
    }

    const messages: ExpoPushMessage[] = validTokens.map((to) => ({
      to,
      ...message,
    }));

    const chunks = this.expo.chunkPushNotifications(messages);
    const tickets: ExpoPushTicket[] = [];
    // Track the token that produced each ticket so we can act on per-token errors.
    const ticketTokens: string[] = [];

    for (const chunk of chunks) {
      try {
        const chunkTickets = await this.expo.sendPushNotificationsAsync(chunk);
        tickets.push(...chunkTickets);
        ticketTokens.push(
          ...chunk.map((m) => (Array.isArray(m.to) ? m.to[0] : m.to)),
        );
      } catch (error) {
        this.logger.error('Expo sendPushNotificationsAsync chunk failed');
        Sentry.captureException(error, {
          extra: { context: 'ExpoPushService.send.chunk' },
        });
      }
    }

    const sentTokens: string[] = [];
    const receiptIdToToken = new Map<ExpoPushReceiptId, string>();

    tickets.forEach((ticket, index) => {
      const token = ticketTokens[index];
      if (!token) return;
      if (ticket.status === 'ok') {
        sentTokens.push(token);
        receiptIdToToken.set(ticket.id, token);
      } else {
        // Immediate ticket error (e.g. DeviceNotRegistered).
        if (ticket.details?.error === 'DeviceNotRegistered') {
          invalidTokens.push(token);
        } else {
          this.logger.warn(
            `Expo ticket error for token: ${ticket.details?.error ?? ticket.message}`,
          );
        }
      }
    });

    // Poll receipts for the accepted tickets to catch deferred delivery errors.
    const deferredInvalid =
      await this.collectInvalidFromReceipts(receiptIdToToken);
    invalidTokens.push(...deferredInvalid);

    // A token that ultimately proved invalid shouldn't also count as "sent".
    const invalidSet = new Set(invalidTokens);
    return {
      sentTokens: sentTokens.filter((t) => !invalidSet.has(t)),
      invalidTokens: [...invalidSet],
    };
  }

  /**
   * Polls Expo receipts and returns tokens whose receipts report
   * DeviceNotRegistered. Receipts are available for ~24h; we poll once shortly
   * after send. Failures here are swallowed (best-effort cleanup).
   */
  private async collectInvalidFromReceipts(
    receiptIdToToken: Map<ExpoPushReceiptId, string>,
  ): Promise<string[]> {
    const receiptIds = [...receiptIdToToken.keys()];
    if (receiptIds.length === 0) return [];

    const invalid: string[] = [];
    const chunks = this.expo.chunkPushNotificationReceiptIds(receiptIds);

    for (const chunk of chunks) {
      try {
        const receipts =
          await this.expo.getPushNotificationReceiptsAsync(chunk);
        for (const [receiptId, receipt] of Object.entries(receipts)) {
          if (receipt.status === 'ok') continue;
          const token = receiptIdToToken.get(receiptId);
          if (receipt.details?.error === 'DeviceNotRegistered' && token) {
            invalid.push(token);
          } else {
            this.logger.warn(
              `Expo receipt error: ${receipt.details?.error ?? receipt.message}`,
            );
          }
        }
      } catch (error) {
        this.logger.warn('Failed to fetch Expo receipts');
        Sentry.captureException(error, {
          extra: { context: 'ExpoPushService.receipts' },
        });
      }
    }

    return invalid;
  }
}
