import { NotificationsService } from './notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { ExpoPushService } from './expo-push.service';
import { PushTokenService } from './push-token.service';
import { NotificationPreferenceService } from './notification-preference.service';

function setup(opts: {
  allowed: boolean;
  tokens?: { token: string }[];
  sendResult?: { sentTokens: string[]; invalidTokens: string[] };
}) {
  const prisma = {
    user: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ language: 'en', timezone: 'UTC' }),
    },
  } as unknown as PrismaService;

  const send = jest
    .fn()
    .mockResolvedValue(
      opts.sendResult ?? { sentTokens: ['t1'], invalidTokens: [] },
    );
  const expoPush = { send } as unknown as ExpoPushService;

  const getEnabledTokens = jest
    .fn()
    .mockResolvedValue(opts.tokens ?? [{ token: 't1' }]);
  const markUsed = jest.fn().mockResolvedValue(undefined);
  const disableTokens = jest.fn().mockResolvedValue(undefined);
  const pushTokens = {
    getEnabledTokens,
    markUsed,
    disableTokens,
  } as unknown as PushTokenService;

  const getOrCreate = jest.fn().mockResolvedValue({});
  const isAllowed = jest.fn().mockReturnValue(opts.allowed);
  const preferences = {
    getOrCreate,
    isAllowed,
  } as unknown as NotificationPreferenceService;

  const service = new NotificationsService(
    prisma,
    expoPush,
    pushTokens,
    preferences,
  );
  return {
    service,
    send,
    getEnabledTokens,
    markUsed,
    disableTokens,
    isAllowed,
  };
}

describe('NotificationsService dispatch', () => {
  it('does not send when the preference check disallows it', async () => {
    const { service, send, getEnabledTokens } = setup({ allowed: false });
    await service.notifyJournalReminder('u1');
    expect(getEnabledTokens).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('sends and marks tokens used when allowed', async () => {
    const { service, send, markUsed, disableTokens } = setup({ allowed: true });
    await service.notifyTradeClosed('u1', {
      tradeId: 'tr1',
      symbol: 'EURUSD',
      pnl: 123.45,
      accountCurrency: 'USD',
      closedReason: 'reached_tp',
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(markUsed).toHaveBeenCalledWith(['t1']);
    // No undeliverable tokens this time (disableTokens itself no-ops on []).
    expect(disableTokens).toHaveBeenCalledWith([], 'DeviceNotRegistered');
  });

  it('disables tokens Expo reported as undeliverable', async () => {
    const { service, disableTokens } = setup({
      allowed: true,
      sendResult: { sentTokens: [], invalidTokens: ['t1'] },
    });
    await service.notifyJournalReminder('u1');
    expect(disableTokens).toHaveBeenCalledWith(['t1'], 'DeviceNotRegistered');
  });

  it('never throws into the caller (best-effort)', async () => {
    const { service, send } = setup({ allowed: true });
    send.mockRejectedValueOnce(new Error('expo down'));
    await expect(service.notifyJournalReminder('u1')).resolves.toBeUndefined();
  });

  it('respects the preference toggle for the weekly behavioral push', async () => {
    const { service, send } = setup({ allowed: false });
    await service.notifyBehavioralReport('u1', {
      reportId: 'r1',
      topPriority: 'overtrading',
    });
    expect(send).not.toHaveBeenCalled();
  });

  it('sends the pattern-specific weekly behavioral push when allowed', async () => {
    const { service, send } = setup({ allowed: true });
    await service.notifyBehavioralReport('u1', {
      reportId: 'r1',
      topPriority: 'early_exit',
    });
    expect(send).toHaveBeenCalledTimes(1);
    const [, message] = send.mock.calls[0];
    expect(message.data.category).toBe('behavioralReports');
    expect(message.data.reportId).toBe('r1');
    // English label for early_exit appears in the body.
    expect(message.body).toContain('exiting winners early');
  });
});
