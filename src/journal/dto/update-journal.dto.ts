import { PartialType } from '@nestjs/mapped-types';
import { CreateJournalDto } from './create-journal.dto';
import { IsString, IsOptional, IsNumber, IsBoolean, IsDate, IsJSON  } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';


export class UpdateJournalDto extends PartialType(CreateJournalDto) {

        @IsNumber()
        @ApiProperty({ description: 'The unique identifier for the journal entry' })
        userId: number;
    
        @IsOptional()
        @IsString()
        @ApiProperty({ description: 'The instrument/currency of the journal entry' })
        symbol: string;
    
        @IsOptional()
        @IsString()
        @ApiProperty({ description: 'The journal content in plain text' })
        plainText: string;
    
        @IsOptional()
        @IsString()
        @ApiProperty({ description: 'The journal content in editor format' })
        editorState: string;
    
        @IsOptional()
        @IsJSON()
        @ApiProperty({ description: 'The user data' })
        author: JSON;
    
        @IsOptional()
        @IsBoolean()
        @ApiProperty({ description: 'Indicates if the journal entry is pinned' })
        isPinned: boolean;
    
        @IsOptional()
        @IsBoolean()
        @ApiProperty({ description: 'Indicates if the journal entry is archived' })
        isArchived: boolean;
}
