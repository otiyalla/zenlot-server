import { IsString, Matches } from 'class-validator';

export class CreatePriceFeedDto {
  @IsString()
  @Matches(/^[A-Za-z]{6}$/)
  symbol: string;
}

export class ExchangeRateDto {
  @IsString()
  @Matches(/^[A-Za-z]{3}$/)
  base: string;

  @IsString()
  @Matches(/^[A-Za-z]{3}$/)
  quote: string;
}
