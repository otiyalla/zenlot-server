import { PartialType } from '@nestjs/swagger';
import { CreateTradeDto } from './create-trade.dto';
import { IsArray, IsString, IsNumber, IsDate, IsJSON, IsOptional, IsObject  } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class UpdateTradeDto extends PartialType(CreateTradeDto) {
    @IsNumber()
    @ApiProperty({ description: 'The unique identifier for the trade' })
    id: number;

    @IsNumber()
    @IsOptional()
    @ApiProperty({ description: 'Risk reward ratio'})
    rr: number

    @IsNumber()
    @IsOptional()
    @ApiProperty({ description: 'The trade risk'})
    risk: number

    @IsNumber()
    @IsOptional()
    @ApiProperty({ description: 'The trade reward'})
    reward: number

    @IsArray()
    @IsOptional()
    @ApiProperty({ description: 'The trade tags'})
    tags: string[]

    @IsDate()
    @ApiProperty({ type: Date, description: 'The date of the journal entry' })
    createdAt: Date;

    @IsDate()
    @ApiProperty({ type: Date, description: 'The last updated date of the journal entry' })
    updatedAt: Date;
 
    @IsOptional()
    @IsDate()
    closedAt?: Date;

    @IsOptional()
    @IsNumber()
    closedPrice?: number

    @IsOptional()
    @IsNumber()
    @Type(() => Number)
    closedExchangeRate?: number

    @IsOptional()
    @IsString()
    closedReason?: string
}
