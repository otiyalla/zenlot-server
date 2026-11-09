import { ForbiddenException } from '@nestjs/common';
import { JournalController } from './journal.controller';
import { JournalService } from './journal.service';
import { AuthenticatedRequest } from '../user/interfaces/authenticated-request.interface';

describe('JournalController authorization', () => {
  const journalService = {
    create: jest.fn(),
    findByUserId: jest.fn(),
    search: jest.fn(),
    findOneByUser: jest.fn(),
    updateByUser: jest.fn(),
    removeByUser: jest.fn(),
  } as unknown as JournalService;

  const controller = new JournalController(journalService);

  beforeEach(() => jest.clearAllMocks());

  it('forces request user id on search', async () => {
    const searchDto = { userId: 'attacker-id', query: 'plan' };
    const req = {
      user: { id: 'owner-1', role: 'trader' },
    } as unknown as AuthenticatedRequest;

    await controller.search(searchDto as never, req);

    expect(searchDto.userId).toBe('owner-1');
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(journalService.search).toHaveBeenCalledWith(searchDto);
  });

  it('blocks access to another user journals', async () => {
    const req = {
      user: { id: 'owner-1', role: 'trader' },
    } as unknown as AuthenticatedRequest;

    await expect(
      controller.findByUserId('owner-2', req),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
