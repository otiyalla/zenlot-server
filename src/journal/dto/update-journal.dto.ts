import { PartialType } from '@nestjs/mapped-types';
import { CreateJournalDto } from './create-journal.dto';
import { IsString, IsOptional, IsBoolean, IsArray } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateJournalDto extends PartialType(CreateJournalDto) {
  @IsOptional()
  @IsString()
  @ApiProperty({ description: 'The journal title' })
  title?: string;

  @IsOptional()
  @IsArray()
  @ApiProperty({ description: 'The user tags' })
  tags?: string[];

  @IsOptional()
  @IsString()
  @ApiProperty({ description: 'The instrument/currency of the journal entry' })
  symbol?: string;

  @IsOptional()
  @IsString()
  @ApiProperty({ description: 'The journal content in plain text' })
  plainText?: string;

  @IsOptional()
  @IsString()
  @ApiProperty({ description: 'The journal content in editor format' })
  editorState?: string;

  @IsOptional()
  @IsBoolean()
  @ApiProperty({ description: 'Indicates if the journal entry is pinned' })
  isPinned?: boolean;

  @IsOptional()
  @IsBoolean()
  @ApiProperty({ description: 'Indicates if the journal entry is archived' })
  isArchived?: boolean;
}
