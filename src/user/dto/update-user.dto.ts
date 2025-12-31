import { PartialType } from '@nestjs/mapped-types';
import { CreateUserDto } from './create-user.dto';
import { IsNumber, IsBoolean, IsDate, IsOptional, IsUUID } from 'class-validator';

export class UpdateUserDto extends PartialType(CreateUserDto) {
    @IsUUID()
    @IsOptional()
    id?: string;

    @IsDate()
    createdAt: Date;

    @IsDate()
    updatedAt: Date;
}