import { ForbiddenException } from '@nestjs/common';
import { JournalController } from './journal.controller';
import { JournalService } from './journal.service';

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
    const searchDto: any = { userId: 'attacker-id', query: 'plan' };
    const req = { user: { id: 'owner-1', role: 'trader' } };

    await controller.search(searchDto, req);

    expect(searchDto.userId).toBe('owner-1');
    expect(journalService.search).toHaveBeenCalledWith(searchDto);
  });

  it('blocks access to another user journals', async () => {
    const req = { user: { id: 'owner-1', role: 'trader' } };

    await expect(
      controller.findByUserId('owner-2', req),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
