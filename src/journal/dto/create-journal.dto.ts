import { IsString, IsArray, IsNumber, IsBoolean, IsDate, IsJSON, IsOptional  } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateJournalDto {
   
    @IsArray()
    @IsOptional()
    @ApiProperty({ description: 'The user tags'})
    tags: string[]

    @IsNumber()
    @ApiProperty({ description: 'The unique identifier for the journal entry' })
    userId: number;

    @IsString()
    @ApiProperty({ description: 'The instrument/currency of the journal entry' })
    symbol: string;

    @IsString()
    @ApiProperty({ description: 'The journal content in plain text' })
    plainText: string;

    @IsString()
    @ApiProperty({ description: 'The journal content in editor format' })
    editorState: string;

    @IsDate()
    @ApiProperty({ type: Date, description: 'The date of the journal entry' })
    createdAt: Date;

    @IsDate()
    @ApiProperty({ type: Date, description: 'The last updated date of the journal entry' })
    updatedAt: Date;

    @IsJSON()
    @ApiProperty({ description: 'The user data' })
    author: JSON;

    @IsBoolean()
    @ApiProperty({ description: 'Indicates if the journal entry is pinned' })
    isPinned: boolean;

    @IsBoolean()
    @ApiProperty({ description: 'Indicates if the journal entry is archived' })
    isArchived: boolean;
}
