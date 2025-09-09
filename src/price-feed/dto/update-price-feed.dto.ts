import { PartialType } from '@nestjs/mapped-types';
import { CreatePriceFeedDto } from './create-price-feed.dto';

export class UpdatePriceFeedDto extends PartialType(CreatePriceFeedDto) {
  id: number;
}
