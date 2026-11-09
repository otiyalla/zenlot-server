import {
  IsString,
  IsArray,
  IsBoolean,
  IsOptional,
  IsUUID,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateJournalDto {
  @IsArray()
  @IsOptional()
  @IsString({ each: true })
  @ApiProperty({ description: 'The user tags' })
  tags: string[];

  @IsUUID()
  @ApiProperty({ description: 'The unique identifier for the journal entry' })
  userId: string;

  @IsString()
  @ApiProperty({ description: 'The instrument/currency of the journal entry' })
  symbol: string;

  @IsString()
  @IsOptional()
  @ApiProperty({ description: 'The journal title' })
  title: string;

  @IsUUID()
  @IsOptional()
  @ApiProperty({ description: 'The trade identifier for the journal entry' })
  tradeId?: string;

  @IsString()
  @IsOptional()
  @ApiProperty({ description: 'The journal content in plain text' })
  plainText?: string;

  @IsString()
  @IsOptional()
  @ApiProperty({ description: 'The journal content in editor format' })
  editorState?: string;

  @IsBoolean()
  @IsOptional()
  @ApiProperty({ description: 'Indicates if the journal entry is pinned' })
  isPinned: boolean;

  @IsBoolean()
  @IsOptional()
  @ApiProperty({ description: 'Indicates if the journal entry is archived' })
  isArchived: boolean;
}
