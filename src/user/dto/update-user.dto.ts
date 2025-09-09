import { PartialType } from '@nestjs/mapped-types';
import { CreateUserDto } from './create-user.dto';
import { IsNumber, IsBoolean, IsDate, IsOptional } from 'class-validator';

export class UpdateUserDto extends PartialType(CreateUserDto) {
    @IsNumber()
    @IsOptional()
    id?: number;

    @IsDate()
    createdAt: Date;

    @IsDate()
    updatedAt: Date;
}