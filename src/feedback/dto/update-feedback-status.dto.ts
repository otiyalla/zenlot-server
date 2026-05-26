import { IsIn } from 'class-validator';

export class UpdateFeedbackStatusDto {
  @IsIn(['open', 'in_progress', 'resolved', 'closed'])
  status: string;
}
