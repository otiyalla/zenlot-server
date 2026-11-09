import { IsOptional, IsUUID } from 'class-validator';

export class TradeOwnerDto {
  @IsOptional()
  @IsUUID()
  userId?: string;
}
