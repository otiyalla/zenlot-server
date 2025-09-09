import { IsString, IsNumber, IsDate, IsJSON, IsOptional, IsObject  } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

class ExitValue {
    @IsNumber()
    value: number;

    @IsNumber()
    pips: number
};

export class CreateTradeDto {

    @IsNumber()
    @ApiProperty({ description: 'The unique identifier for the trade' })
    //id: number;

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

    @IsObject()
    @ApiProperty({ description: 'The trade stop loss value' })
    stopLoss: ExitValue;

    @IsObject()
    @ApiProperty({ description: 'The trade take profit value' })
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
/* 
    @IsDate()
    @ApiProperty({ type: Date, description: 'The date of the journal entry' })
    createdAt: Date;

    @IsDate()
    @ApiProperty({ type: Date, description: 'The last updated date of the journal entry' })
    updatedAt: Date;
 */
}

