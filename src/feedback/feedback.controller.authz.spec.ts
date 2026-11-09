import { ForbiddenException } from '@nestjs/common';
import { FeedbackController } from './feedback.controller';
import { FeedbackService } from './feedback.service';
import { AuthenticatedRequest } from '../user/interfaces/authenticated-request.interface';

describe('FeedbackController authorization', () => {
  const feedbackService = {
    updateFeedbackStatus: jest.fn(),
  } as unknown as FeedbackService;

  const controller = new FeedbackController(feedbackService);

  beforeEach(() => jest.clearAllMocks());

  it('rejects feedback status updates from non-admin users', async () => {
    await expect(
      controller.updateFeedbackStatus('feedback-1', { status: 'closed' }, {
        user: { id: 'user-1', role: 'trader' },
      } as unknown as AuthenticatedRequest),
    ).rejects.toBeInstanceOf(ForbiddenException);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(feedbackService.updateFeedbackStatus).not.toHaveBeenCalled();
  });

  it('allows admins to update feedback status', async () => {
    await controller.updateFeedbackStatus('feedback-1', { status: 'closed' }, {
      user: { id: 'admin-1', role: 'admin' },
    } as unknown as AuthenticatedRequest);

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(feedbackService.updateFeedbackStatus).toHaveBeenCalledWith(
      'feedback-1',
      'closed',
    );
  });
});
