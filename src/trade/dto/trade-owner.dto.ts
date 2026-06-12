import { IsUUID } from 'class-validator';

export class TradeOwnerDto {
  @IsUUID()
  userId: string;
}
