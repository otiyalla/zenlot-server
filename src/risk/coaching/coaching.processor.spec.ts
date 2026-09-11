import { Job } from 'bullmq';
import { CoachingProcessor, CoachingJobData } from './coaching.processor';
import { CoachingService } from './coaching.service';
import { PrismaService } from '../../prisma/prisma.service';
import { QuoteGateway } from '../../quote/quote.gateway';
import { NotificationsService } from '../../notifications/notifications.service';

const jobData: CoachingJobData = {
  governanceLogId: 'g1',
  tradeId: 't1',
  userId: 'u1',
  language: 'en',
  accountCurrency: 'USD',
  calculation: {} as CoachingJobData['calculation'],
  governance: {} as CoachingJobData['governance'],
};

function make(coachingResult: string | null) {
  const generateCoaching = jest.fn().mockResolvedValue(coachingResult);
  const update = jest.fn().mockResolvedValue({});
  const emitCoachingReady = jest.fn();
  const notifyCoachingReady = jest.fn().mockResolvedValue(undefined);

  const processor = new CoachingProcessor(
    { generateCoaching } as unknown as CoachingService,
    { governanceLog: { update } } as unknown as PrismaService,
    { emitCoachingReady } as unknown as QuoteGateway,
    { notifyCoachingReady } as unknown as NotificationsService,
  );
  return { processor, update, emitCoachingReady, notifyCoachingReady };
}

const job = { data: jobData } as Job<CoachingJobData>;

describe('CoachingProcessor.process', () => {
  it('persists the coaching and pushes it over WebSocket', async () => {
    const { processor, update, emitCoachingReady } = make('Solid setup.');
    await processor.process(job);

    expect(update).toHaveBeenCalledWith({
      where: { id: 'g1' },
      data: { aiCoaching: 'Solid setup.' },
    });
    expect(emitCoachingReady).toHaveBeenCalledWith('u1', {
      governanceLogId: 'g1',
      tradeId: 't1',
      coaching: 'Solid setup.',
    });
  });

  it('does nothing when no coaching was produced', async () => {
    const { processor, update, emitCoachingReady } = make(null);
    await processor.process(job);
    expect(update).not.toHaveBeenCalled();
    expect(emitCoachingReady).not.toHaveBeenCalled();
  });
});
