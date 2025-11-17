import { IsArray, IsString, IsNumber, IsDate, IsJSON, IsOptional, IsObject, ValidateNested  } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

class ExitValue {
    @IsNumber()
    value: number;

    @IsNumber()
    pips: number
};

export class CreateTradeDto {
/*
    @IsNumber()
    @ApiProperty({ description: 'The unique identifier for the trade' })
    //id: number;
*/
    @IsNumber()
    @ApiProperty({ description: 'The trade user id' })
    userId: number;

    @IsString()
    @ApiProperty({ description: 'The instrument/currency of the trade entered' })
    symbol: string;

    @IsNumber()
    @ApiProperty({ description: 'The trade entry value' })
    entry: number;

    @IsNumber()
    @ApiProperty({ description: 'The trade lot size' })
    lot: number;

    @IsNumber()
    @ApiProperty({ description: 'The trade pips value' })
    pips: number;

    @IsString()
    @ApiProperty({ description: 'The trade execution, if it is a buy or sell' })
    execution: string;

    @IsNumber()
    @ApiProperty({ description: 'The trade exchange rate' })
    exchangeRate: number;

    @ValidateNested()
    @Type(() => ExitValue)
    @ApiProperty({ type: ExitValue, description: 'The trade stop loss value' })
    stopLoss: ExitValue;

    @ValidateNested()
    @Type(() => ExitValue)
    @ApiProperty({ type: ExitValue, description: 'The trade take profit value' })
    takeProfit: ExitValue;

    @IsString()
    @IsOptional()
    @ApiProperty({ description: 'The trade journal content in plain text' })
    plainText: string | undefined | null;

    @IsString()
    @IsOptional()
    @ApiProperty({ description: 'The trade journal content in editor format' })
    editorState: string | undefined | null;

    @IsString()
    @ApiProperty({ description: 'The trade status' })
    status: string;

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
/* 
    @IsDate()
    @ApiProperty({ type: Date, description: 'The date of the journal entry' })
    createdAt: Date;

    @IsDate()
    @ApiProperty({ type: Date, description: 'The last updated date of the journal entry' })
    updatedAt: Date;
 */
}

