import { IsNumber, IsString, MinLength, IsOptional } from "class-validator";

export class UserPasswordDto {
    @IsNumber()
    userId: number;
    
    @IsString()
    @MinLength(8)
    currentPassword: string;

    @IsString()
    @MinLength(8)
    newPassword: string;

    @IsString()
    @IsOptional()
    @MinLength(8)
    confirmPassword?: string;
}